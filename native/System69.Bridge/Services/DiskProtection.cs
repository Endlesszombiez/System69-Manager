using System69.Core;
using Microsoft.Win32;

namespace System69.App.Services;

public static class DiskProtection
{
    public static DiskDeletePolicy Create(string dataDirectory)
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var appRoot = Environment.GetEnvironmentVariable("SYSTEM69_APP_ROOT") ?? AppContext.BaseDirectory;
        List<string> subtrees = [appRoot, dataDirectory,
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)];
        if (!string.IsNullOrWhiteSpace(profile)) subtrees.Add(Path.Combine(profile, "AppData"));
        foreach (var a in InventoryService.ReadWindowsInventory())
            if (!string.IsNullOrWhiteSpace(a.InstallLocation)) { try { subtrees.Add(Path.GetFullPath(a.InstallLocation)); } catch { /* No path is inferred from an executable. */ } }
        var users = Path.GetDirectoryName(profile);
        if (users is not null)
            foreach (var other in Directory.EnumerateDirectories(users))
                if (!CleanupPolicy.Same(CleanupPolicy.Canonical(other), CleanupPolicy.Canonical(profile))) subtrees.Add(other);
        List<string> containers = [profile];
        foreach (var special in new[] { Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments, Environment.SpecialFolder.MyPictures, Environment.SpecialFolder.MyMusic, Environment.SpecialFolder.MyVideos })
            containers.Add(Environment.GetFolderPath(special));
        if (!string.IsNullOrWhiteSpace(profile)) { containers.Add(Path.Combine(profile, "Downloads")); containers.Add(Path.Combine(profile, "OneDrive")); }
        var redirectedDownloads = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders", "{374DE290-123F-4565-9164-39C4925E467B}", null) as string;
        if (!string.IsNullOrWhiteSpace(redirectedDownloads)) containers.Add(Environment.ExpandEnvironmentVariables(redirectedDownloads));
        foreach (var variable in new[] { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" })
            if (Environment.GetEnvironmentVariable(variable) is { Length: > 0 } cloudRoot) containers.Add(cloudRoot);
        return new(subtrees, containers);
    }
}
