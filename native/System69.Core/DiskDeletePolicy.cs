using System.Text.RegularExpressions;

namespace System69.Core;

/// <summary>Conservative disk-map deletion policy. Mapping never implies permission to delete.</summary>
public sealed class DiskDeletePolicy(IEnumerable<string> protectedSubtrees, IEnumerable<string> protectedContainers)
{
    private readonly string[] subtrees = protectedSubtrees.Where(x => !string.IsNullOrWhiteSpace(x)).Select(CleanupPolicy.Canonical).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    private readonly string[] containers = protectedContainers.Where(x => !string.IsNullOrWhiteSpace(x)).Select(CleanupPolicy.Canonical).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase) { "Windows", "System32", "SysWOW64", "WinSxS", "Program Files", "Program Files (x86)", "ProgramData", "$Recycle.Bin", "System Volume Information", "Recovery", "Boot", "EFI", "$WINDOWS.~BT", "$WINDOWS.~WS", "Windows.old", "Config.Msi", "MSOCache", "Documents and Settings", "PerfLogs", "WpSystem", "WUDownloadCache", "$WinREAgent", "$SysReset" };
    private static readonly HashSet<string> CriticalExtensions = new(StringComparer.OrdinalIgnoreCase) { ".sys", ".efi", ".drv", ".dll", ".ocx", ".cpl" };
    private static readonly HashSet<string> CriticalNames = new(StringComparer.OrdinalIgnoreCase) { "bootmgr", "bootnxt", "ntldr", "ntdetect.com", "boot.ini", "bootsect.bak", "bcd" };

    public CleanupDecision Evaluate(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || !Regex.IsMatch(raw, @"^[A-Za-z]:[\\/]") || raw[2..].Contains(':') || raw.IndexOfAny(['\0', '"', '<', '>', '|', '?', '*']) >= 0 || raw.Split(['\\', '/']).Any(x => x is "." or ".." || x.EndsWith(' ') || x.EndsWith('.')))
            return Deny("Only unambiguous local absolute paths are eligible. Network, device, traversal and stream paths are blocked.");
        string path;
        try { path = CleanupPolicy.Canonical(raw); } catch { return Deny("Invalid path."); }
        if (CleanupPolicy.Same(path, Path.GetPathRoot(path)!)) return Deny("Drive roots cannot be deleted.");
        try { if (new DriveInfo(Path.GetPathRoot(path)!).DriveType != DriveType.Fixed) return Deny("Deletion is limited to fixed local disks with Recycle Bin support."); } catch { return Deny("The local drive could not be verified."); }
        if (path.Split(['\\', '/']).Any(Reserved.Contains)) return Deny("Windows, shared application, recovery and system locations are protected.");
        if (CriticalNames.Contains(Path.GetFileName(path)) || CriticalExtensions.Contains(Path.GetExtension(path))) return Deny("System and application component files are protected.");
        if (subtrees.Any(p => Overlaps(path, p))) return Deny("This location overlaps Windows, an installed application, app data, or another protected location.");
        if (containers.Any(p => CleanupPolicy.Same(path, p) || CleanupPolicy.IsChild(p, path))) return Deny("Profile and known-folder containers cannot be deleted.");
        try
        {
            for (var current = path; ; current = Path.GetDirectoryName(current)!)
            {
                var attributes = File.GetAttributes(current);
                if ((attributes & FileAttributes.ReparsePoint) != 0) return Deny("Links, junctions, mount points and cloud placeholders are protected.");
                if (Path.GetDirectoryName(current) is not null && (attributes & (FileAttributes.System | FileAttributes.Hidden | FileAttributes.Offline)) != 0)
                    return Deny("System, hidden or offline content and their descendants are protected.");
                if (CleanupPolicy.Same(current, path) && (attributes & (FileAttributes.System | FileAttributes.Hidden | FileAttributes.ReadOnly | FileAttributes.Offline)) != 0)
                    return Deny("System, hidden, read-only or offline content is protected.");
                var parent = Path.GetDirectoryName(current);
                if (parent is null) break;
            }
            return new(true, "Eligible for a reviewed move to the Recycle Bin.", path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return Deny("File attributes or ownership boundaries could not be verified."); }
    }

    public DiskStamp Inspect(string path)
    {
        var first = Evaluate(path);
        if (!first.Allowed) throw new InvalidOperationException(first.Reason);
        var canonical = first.CanonicalPath!;
        var initial = File.GetAttributes(canonical);
        var directory = (initial & FileAttributes.Directory) != 0;
        long bytes = 0; int count = 0;
        Stack<(string Path, int Depth)> pending = new(); pending.Push((canonical, 0));
        while (pending.TryPop(out var item))
        {
            if (item.Depth > 64 || ++count > 100000) throw new IOException("Deletion inspection exceeds its safety budget. Map and select a smaller folder.");
            var decision = Evaluate(item.Path);
            if (!decision.Allowed) throw new InvalidOperationException("Protected content: " + item.Path + ". " + decision.Reason);
            if (!CleanupPolicy.Same(item.Path, canonical) && !CleanupPolicy.IsChild(item.Path, canonical)) throw new IOException("An entry escaped the selected folder.");
            if ((File.GetAttributes(item.Path) & FileAttributes.Directory) != 0)
                foreach (var child in Directory.EnumerateFileSystemEntries(item.Path))
                {
                    if (pending.Count + count >= 100000) throw new IOException("Deletion inspection exceeds its safety budget. Select a smaller folder.");
                    pending.Push((child, item.Depth + 1));
                }
            else bytes += new FileInfo(item.Path).Length;
        }
        return new(canonical, directory, File.GetCreationTimeUtc(canonical).Ticks, File.GetLastWriteTimeUtc(canonical).Ticks, count, bytes);
    }

    public string Quarantine(DiskStamp approved)
    {
        if (Inspect(approved.Path) != approved) throw new IOException("The selected content changed after review. Map and review it again.");
        var quarantine = Path.Combine(Path.GetDirectoryName(approved.Path)!, ".system69-recycle-" + Guid.NewGuid().ToString("N") + "-" + Path.GetFileName(approved.Path));
        if (approved.Directory) Directory.Move(approved.Path, quarantine); else File.Move(approved.Path, quarantine);
        try
        {
            var checkedAgain = Inspect(quarantine);
            if (checkedAgain.Entries != approved.Entries || checkedAgain.Bytes != approved.Bytes) throw new IOException("Content changed while preparing deletion.");
            return quarantine;
        }
        catch
        {
            if (approved.Directory) Directory.Move(quarantine, approved.Path); else File.Move(quarantine, approved.Path);
            throw;
        }
    }
    private static bool Overlaps(string a, string b) => CleanupPolicy.Same(a, b) || CleanupPolicy.IsChild(a, b) || CleanupPolicy.IsChild(b, a);
    private static CleanupDecision Deny(string reason) => new(false, reason);
}
public sealed record DiskStamp(string Path, bool Directory, long Created, long Modified, int Entries, long Bytes);
