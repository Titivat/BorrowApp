using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace BorrowApp.Api;

public class StaffUser : IdentityUser { }
public class Item
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string AssetTag { get; set; } = "";
    public string Category { get; set; } = "";
    public string Location { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Status { get; set; } = "Available";
    public string? PhotoKey { get; set; }
    public string? PhotoType { get; set; }
}
public class Loan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ItemId { get; set; }
    public Item Item { get; set; } = null!;
    public string BorrowerName { get; set; } = "";
    public string BorrowerEmail { get; set; } = "";
    public string Department { get; set; } = "";
    public string Purpose { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime DueAt { get; set; }
    public DateTime? ReturnedAt { get; set; }
    public string ReturnNotes { get; set; } = "";
}
public class AuditEntry
{
    public long Id { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string Actor { get; set; } = "";
    public string Action { get; set; } = "";
    public string Detail { get; set; } = "";
}
public class Reminder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid LoanId { get; set; }
    public DateTime Day { get; set; }
    public string Recipient { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTime? SentAt { get; set; }
}
public class AppDb(DbContextOptions<AppDb> options) : IdentityDbContext<StaffUser>(options)
{
    public DbSet<Item> Items => Set<Item>();
    public DbSet<Loan> Loans => Set<Loan>();
    public DbSet<AuditEntry> Audit => Set<AuditEntry>();
    public DbSet<Reminder> Reminders => Set<Reminder>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.Entity<Item>().HasIndex(x => x.AssetTag).IsUnique();
        b.Entity<Reminder>().HasIndex(x => new { x.LoanId, x.Day }).IsUnique();
        b.Entity<Loan>().HasOne(x => x.Item).WithMany().HasForeignKey(x => x.ItemId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Item>().Property(x => x.Name).HasMaxLength(160);
        b.Entity<Item>().Property(x => x.AssetTag).HasMaxLength(80);
    }
}
