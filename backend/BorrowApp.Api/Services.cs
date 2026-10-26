using System.Net;
using System.Net.Mail;
using System.Net.Http.Headers;
using Microsoft.EntityFrameworkCore;

namespace BorrowApp.Api;

public class PhotoStorage(IConfiguration config, IWebHostEnvironment environment, IHttpClientFactory clients)
{
    private bool Remote => !string.IsNullOrWhiteSpace(config["Storage:Url"]);
    private string LocalPath(string key) => Path.Combine(environment.ContentRootPath, "data", "photos", key);
    private HttpRequestMessage Request(HttpMethod method, string key)
    {
        var url = config["Storage:Url"]!.TrimEnd('/') + "/storage/v1/object/" + (config["Storage:Bucket"] ?? "item-photos") + "/" + key;
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config["Storage:ServiceKey"]);
        request.Headers.Add("apikey", config["Storage:ServiceKey"]);
        return request;
    }
    public async Task Save(string key, byte[] bytes, string type)
    {
        if (!Remote)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LocalPath(key))!);
            await File.WriteAllBytesAsync(LocalPath(key), bytes);
            return;
        }
        using var request = Request(HttpMethod.Post, key);
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(type);
        using var response = await clients.CreateClient().SendAsync(request);
        response.EnsureSuccessStatusCode();
    }
    public async Task<byte[]> Read(string key)
    {
        if (!Remote) return await File.ReadAllBytesAsync(LocalPath(key));
        using var request = Request(HttpMethod.Get, key);
        using var response = await clients.CreateClient().SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync();
    }
}

public class ReminderService(AppDb db, IConfiguration config, ILogger<ReminderService> logger, IHttpClientFactory clients)
{
    public static bool IsConfigured(IConfiguration config) => !string.IsNullOrWhiteSpace(config["Email:ApiKey"]) || !string.IsNullOrWhiteSpace(config["Smtp:Host"]);
    public async Task<object> Run()
    {
        var today = DateTime.UtcNow.Date;
        var tomorrow = today.AddDays(2);
        var loans = await db.Loans.Include(x => x.Item).Where(x => x.Status == "Borrowed" && x.DueAt < tomorrow).ToListAsync();
        foreach (var loan in loans)
        {
            if (await db.Reminders.AnyAsync(x => x.LoanId == loan.Id && x.Day == today)) continue;
            db.Reminders.Add(new Reminder
            {
                LoanId = loan.Id,
                Day = today,
                Recipient = loan.BorrowerEmail,
                Message = $"Hello {loan.BorrowerName}, {loan.Item.Name} ({loan.Item.AssetTag}) is due {loan.DueAt:yyyy-MM-dd}. Please contact IT/HR to arrange its return."
            });
        }
        // The unique index makes concurrent scheduled/manual runs idempotent.
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); }
        var sent = 0;
        if (IsConfigured(config))
        {
            using var smtp = new SmtpClient(config["Smtp:Host"] ?? "localhost", config.GetValue("Smtp:Port", 587))
            { EnableSsl = true, Credentials = new NetworkCredential(config["Smtp:Username"], config["Smtp:Password"]) };
            var active = loans.Select(x => x.Id).ToArray();
            foreach (var reminder in await db.Reminders.Where(x => x.Day == today && x.SentAt == null && active.Contains(x.LoanId)).ToListAsync())
            {
                try
                {
                    if (!string.IsNullOrWhiteSpace(config["Email:ApiKey"]))
                    {
                        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.brevo.com/v3/smtp/email");
                        request.Headers.Add("api-key", config["Email:ApiKey"]);
                        request.Content = JsonContent.Create(new { sender = new { email = config["Email:From"], name = "BorrowApp" }, to = new[] { new { email = reminder.Recipient } }, subject = "Equipment return reminder", textContent = reminder.Message, htmlContent = "<p>" + WebUtility.HtmlEncode(reminder.Message) + "</p>" });
                        using var response = await clients.CreateClient().SendAsync(request);
                        response.EnsureSuccessStatusCode();
                    }
                    else
                    {
                        using var message = new MailMessage(config["Smtp:From"]!, reminder.Recipient, "Equipment return reminder", reminder.Message);
                        await smtp.SendMailAsync(message);
                    }
                    reminder.SentAt = DateTime.UtcNow;
                    await db.SaveChangesAsync();
                    sent++;
                }
                catch (Exception ex) when (ex is SmtpException or HttpRequestException) { logger.LogWarning("Reminder {ReminderId} could not be sent; it remains queued.", reminder.Id); }
            }
        }
        return new { eligibleLoans = loans.Count, sent, emailConfigured = IsConfigured(config) };
    }
}
