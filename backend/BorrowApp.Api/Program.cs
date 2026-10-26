using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using BorrowApp.Api;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true).AddEnvironmentVariables();
Directory.CreateDirectory(Path.Combine(builder.Environment.ContentRootPath, "data"));
var postgres = builder.Configuration["DatabaseProvider"] == "Postgres";
if (builder.Environment.IsProduction() && (!postgres || string.IsNullOrWhiteSpace(builder.Configuration["Storage:Url"])))
    throw new InvalidOperationException("Production requires PostgreSQL and durable photo storage. Configure DatabaseProvider, ConnectionStrings__Database and Storage__Url.");
builder.Services.AddDbContext<AppDb>(o => { if (postgres) o.UseNpgsql(builder.Configuration.GetConnectionString("Database")); else o.UseSqlite(builder.Configuration.GetConnectionString("Database")); });
builder.Services.AddIdentity<StaffUser, IdentityRole>(o =>
{
    o.Password.RequiredLength = 12; o.User.RequireUniqueEmail = true;
    o.Lockout.MaxFailedAccessAttempts = 5; o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
}).AddEntityFrameworkStores<AppDb>().AddDefaultTokenProviders();
builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "BorrowApp.Session"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization(o => o.AddPolicy("Staff", p => p.RequireRole("Admin", "Staff")));
builder.Services.AddAntiforgery(o => { o.HeaderName = "X-CSRF-TOKEN"; o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always; });
builder.Services.AddRateLimiter(o => { o.RejectionStatusCode = 429; o.AddPolicy("login", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) })); });
builder.Services.AddHttpClient();
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, "data", "keys")));
builder.Services.AddScoped<PhotoStorage>();
builder.Services.AddScoped<ReminderService>();
builder.Services.AddProblemDetails();
var app = builder.Build();
app.UseExceptionHandler();
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "same-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'";
    await next();
});
app.UseDefaultFiles(); app.UseStaticFiles();
app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(context.Request.Method) && context.Request.Path != "/api/jobs/reminders")
    {
        try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
        catch (AntiforgeryValidationException) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = "Refresh the page and try again (invalid CSRF token)." }); return; }
    }
    await next();
});
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/session", (HttpContext c, IAntiforgery anti) => Results.Ok(new
{
    csrfToken = anti.GetAndStoreTokens(c).RequestToken,
    user = c.User.Identity?.IsAuthenticated == true ? new { email = c.User.Identity.Name, role = c.User.IsInRole("Admin") ? "Admin" : "Staff" } : null
}));
app.MapPost("/api/login", async (LoginInput input, SignInManager<StaffUser> signIn) =>
{
    if (string.IsNullOrWhiteSpace(input.Email) || string.IsNullOrWhiteSpace(input.Password)) return Results.BadRequest(new { error = "Enter your email and password." });
    var result = await signIn.PasswordSignInAsync(input.Email.Trim(), input.Password, false, true);
    return result.Succeeded ? Results.Ok() : Results.Json(new { error = "Login failed. Check your credentials or try again later." }, statusCode: 401);
}).RequireRateLimiting("login");
app.MapPost("/api/logout", async (SignInManager<StaffUser> s) => { await s.SignOutAsync(); return Results.Ok(); }).RequireAuthorization();
var api = app.MapGroup("/api").RequireAuthorization("Staff").AddEndpointFilter(async (context, next) =>
{
    foreach (var argument in context.Arguments)
        if (argument is ItemInput or LoanInput or ReturnInput or UserInput)
            foreach (var property in argument.GetType().GetProperties())
                if (property.PropertyType == typeof(string) && property.GetValue(argument) is null)
                    return Bad("Text fields cannot be null. Use an empty string for optional fields.");
    return await next(context);
});
api.MapGet("/items", async (AppDb db) => await db.Items.OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.AssetTag, x.Category, x.Location, x.Notes, x.Status, hasPhoto = x.PhotoKey != null }).ToListAsync());
api.MapPost("/items", async (ItemInput input, AppDb db, HttpContext c) =>
{
    if (!ValidText(input.Name, 160) || !ValidText(input.AssetTag, 80) || !ValidText(input.Category, 80) || !ValidText(input.Location, 160) || input.Notes.Length > 2000) return Bad("Complete the item details (name, tag, category and location).");
    var item = new Item { Name = input.Name.Trim(), AssetTag = input.AssetTag.Trim().ToUpperInvariant(), Category = input.Category.Trim(), Location = input.Location.Trim(), Notes = input.Notes.Trim() };
    db.Items.Add(item); Audit(db, c, "Item added", item.AssetTag + " · " + item.Name);
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { error = "That asset tag already exists." }); }
    return Results.Ok(new { item.Id });
});
api.MapPost("/items/{id:guid}/photo", async (Guid id, HttpContext c, AppDb db, PhotoStorage storage) =>
{
    var item = await db.Items.FindAsync(id); if (item is null) return Results.NotFound();
    if (!c.Request.HasFormContentType || c.Request.ContentLength > 6 * 1024 * 1024) return Bad("Choose a JPEG or PNG photo up to 5 MB.");
    var file = (await c.Request.ReadFormAsync()).Files.GetFile("photo");
    if (file is null || file.Length < 8 || file.Length > 5 * 1024 * 1024) return Bad("Choose a JPEG or PNG photo up to 5 MB.");
    using var memory = new MemoryStream(); await file.CopyToAsync(memory); var bytes = memory.ToArray();
    var png = bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
    var jpeg = bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255;
    if (!png && !jpeg) return Bad("Only JPEG and PNG images are supported.");
    var key = Guid.NewGuid().ToString("N") + (png ? ".png" : ".jpg"); var type = png ? "image/png" : "image/jpeg";
    await storage.Save(key, bytes, type); item.PhotoKey = key; item.PhotoType = type;
    Audit(db, c, "Photo updated", item.AssetTag); await db.SaveChangesAsync(); return Results.Ok();
});
api.MapGet("/items/{id:guid}/photo", async (Guid id, AppDb db, PhotoStorage storage, HttpContext c) =>
{
    var item = await db.Items.FindAsync(id); if (item?.PhotoKey is null) return Results.NotFound();
    c.Response.Headers.CacheControl = "private, no-store";
    return Results.File(await storage.Read(item.PhotoKey), item.PhotoType!);
});
api.MapGet("/loans", async (AppDb db) => await db.Loans.Include(x => x.Item).OrderByDescending(x => x.RequestedAt).Select(x => new { x.Id, x.ItemId, itemName = x.Item.Name, assetTag = x.Item.AssetTag, x.BorrowerName, x.BorrowerEmail, x.Department, x.Purpose, x.Status, x.RequestedAt, x.DueAt, x.ReturnedAt, x.ReturnNotes }).ToListAsync());
api.MapPost("/loans", async (LoanInput input, AppDb db, HttpContext c) =>
{
    if (!ValidText(input.BorrowerName, 160) || !new EmailAddressAttribute().IsValid(input.BorrowerEmail) || input.BorrowerEmail.Length > 254 || input.Department.Length > 160 || input.Purpose.Length > 2000 || input.DueAt.Kind != DateTimeKind.Utc || input.DueAt <= DateTime.UtcNow || input.DueAt > DateTime.UtcNow.AddYears(2)) return Bad("Enter a borrower name, valid email and future due date (within two years).");
    await using var tx = await db.Database.BeginTransactionAsync();
    var count = await db.Items.Where(x => x.Id == input.ItemId && x.Status == "Available").ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, "Requested"));
    if (count != 1) return Results.Conflict(new { error = "This item is no longer available." });
    var loan = new Loan { ItemId = input.ItemId, BorrowerName = input.BorrowerName.Trim(), BorrowerEmail = input.BorrowerEmail.Trim(), Department = input.Department.Trim(), Purpose = input.Purpose.Trim(), DueAt = input.DueAt };
    db.Loans.Add(loan); Audit(db, c, "Loan requested", $"{loan.BorrowerName} · {loan.Id}"); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { loan.Id });
});
api.MapPost("/loans/{id:guid}/{action}", async (Guid id, string action, ReturnInput input, AppDb db, HttpContext c) =>
{
    var expected = action == "return" ? "Borrowed" : "Pending";
    var next = action switch { "approve" => "Borrowed", "reject" => "Rejected", "return" => "Returned", _ => "" };
    if (next == "" || input.Notes.Length > 2000) return Bad("Invalid action or notes too long.");
    await using var tx = await db.Database.BeginTransactionAsync();
    var loan = await db.Loans.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id); if (loan is null) return Results.NotFound();
    var count = await db.Loans.Where(x => x.Id == id && x.Status == expected).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, next).SetProperty(x => x.ReturnedAt, action == "return" ? (DateTime?)DateTime.UtcNow : null).SetProperty(x => x.ReturnNotes, input.Notes.Trim()));
    if (count != 1) return Results.Conflict(new { error = "This loan has already changed. Refresh and try again." });
    await db.Items.Where(x => x.Id == loan.ItemId).ExecuteUpdateAsync(s => s.SetProperty(x => x.Status, action == "approve" ? "Borrowed" : "Available"));
    Audit(db, c, "Loan " + next.ToLowerInvariant(), $"{loan.BorrowerName} · {id}"); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok();
});
api.MapGet("/audit", async (AppDb db) => await db.Audit.OrderByDescending(x => x.Id).Take(200).ToListAsync());
api.MapGet("/reminders", async (AppDb db, IConfiguration config) => new { emailConfigured = ReminderService.IsConfigured(config), entries = await db.Reminders.OrderByDescending(x => x.Day).Take(200).ToListAsync() });
api.MapPost("/reminders/run", async (ReminderService service) => Results.Ok(await service.Run()));
app.MapPost("/api/jobs/reminders", async (HttpContext c, IConfiguration config, ReminderService service) =>
{
    var expected = config["Jobs:Secret"];
    var actual = c.Request.Headers.Authorization.ToString();
    if (string.IsNullOrWhiteSpace(expected) || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes("Bearer " + expected)), SHA256.HashData(Encoding.UTF8.GetBytes(actual)))) return Results.Unauthorized();
    return Results.Ok(await service.Run());
});
api.MapGet("/users", async (UserManager<StaffUser> users) => { var rows = new List<object>(); foreach (var user in await users.Users.ToListAsync()) rows.Add(new { user.Id, user.Email, roles = await users.GetRolesAsync(user) }); return Results.Ok(rows); }).RequireAuthorization(p => p.RequireRole("Admin"));
api.MapPost("/users", async (UserInput input, UserManager<StaffUser> users, AppDb db, HttpContext c) =>
{
    if (!new EmailAddressAttribute().IsValid(input.Email) || input.Role is not ("Admin" or "Staff")) return Bad("Choose a valid email and role.");
    var user = new StaffUser { UserName = input.Email.Trim(), Email = input.Email.Trim() };
    var result = await users.CreateAsync(user, input.Password);
    if (!result.Succeeded) return Bad(string.Join(" ", result.Errors.Select(x => x.Description)));
    var roleResult = await users.AddToRoleAsync(user, input.Role);
    if (!roleResult.Succeeded) { await users.DeleteAsync(user); return Bad("Unable to assign the staff role."); }
    Audit(db, c, "Staff account created", input.Email + " · " + input.Role); await db.SaveChangesAsync(); return Results.Ok();
}).RequireAuthorization(p => p.RequireRole("Admin"));
app.MapFallbackToFile("index.html");
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    if (postgres) await db.Database.MigrateAsync(); else await db.Database.EnsureCreatedAsync();
    var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
    foreach (var role in new[] { "Admin", "Staff" }) if (!await roles.RoleExistsAsync(role)) await roles.CreateAsync(new IdentityRole(role));
    var users = scope.ServiceProvider.GetRequiredService<UserManager<StaffUser>>();
    var email = builder.Configuration["Bootstrap:Email"]; var password = builder.Configuration["Bootstrap:Password"];
    if (!await users.Users.AnyAsync() && !string.IsNullOrWhiteSpace(email) && !string.IsNullOrWhiteSpace(password))
    {
        var user = new StaffUser { UserName = email, Email = email };
        var result = await users.CreateAsync(user, password);
        if (!result.Succeeded) throw new InvalidOperationException("Bootstrap admin failed: " + string.Join("; ", result.Errors.Select(x => x.Description)));
        await users.AddToRoleAsync(user, "Admin");
    }
}
await app.RunAsync();
static bool ValidText(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Length <= max;
static IResult Bad(string message) => Results.BadRequest(new { error = message });
static void Audit(AppDb db, HttpContext c, string action, string detail) => db.Audit.Add(new AuditEntry { Actor = c.User.Identity?.Name ?? "system", Action = action, Detail = detail });
record LoginInput(string Email, string Password);
record ItemInput(string Name, string AssetTag, string Category, string Location, string Notes);
record LoanInput(Guid ItemId, string BorrowerName, string BorrowerEmail, string Department, string Purpose, DateTime DueAt);
record ReturnInput(string Notes);
record UserInput(string Email, string Password, string Role);
public partial class Program { }
