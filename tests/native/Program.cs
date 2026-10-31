using System69.Core;

if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Run Windows path safety tests on Windows.");
int passed = 0;
void Test(string name, Action action) { action(); Console.WriteLine("PASS " + name); passed++; }
void Assert(bool condition, string message = "Assertion failed") { if (!condition) throw new Exception(message); }
void Throws(Action action) { try { action(); } catch (Exception) { return; } throw new Exception("Expected an exception"); }

var fixtureParent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
var fixture = Path.Combine(fixtureParent, "system69-tests-" + Guid.NewGuid().ToString("N"));
var appsRoot = Path.Combine(fixture, "Programs");
var protectedRoot = Path.Combine(appsRoot, "Common Files");
var appPath = Path.Combine(appsRoot, "Example App");
Directory.CreateDirectory(appPath);
Directory.CreateDirectory(protectedRoot);
var policy = new CleanupPolicy([appsRoot], [protectedRoot], Path.Combine(appsRoot, "System69"));
var app = new InstalledApp("fixture", "Example App", "1", "Test", PackageSource.Windows, InstallLocation: appPath);
try
{
    Test("verified exclusive app folder is eligible", () => Assert(policy.Evaluate(app, [app]).Allowed));
    Test("drive root is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = Path.GetPathRoot(appPath) }, []).Allowed));
    Test("application root is blocked", () => Assert(!policy.Evaluate(app with { Name = "Programs", InstallLocation = appsRoot }, []).Allowed));
    Test("Windows folder is blocked", () => Assert(!policy.Evaluate(app with { Name = "Windows", InstallLocation = Environment.GetFolderPath(Environment.SpecialFolder.Windows) }, []).Allowed));
    Test("shared protected folder is blocked", () => Assert(!policy.Evaluate(app with { Name = "Common Files", InstallLocation = protectedRoot }, []).Allowed));
    Test("protected subtree is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = Path.Combine(protectedRoot, "Example App") }, []).Allowed));
    Test("own installation is blocked", () => Assert(!policy.Evaluate(app with { Name = "System69", InstallLocation = Path.Combine(appsRoot, "System69") }, []).Allowed));
    Test("missing path is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = null }, []).Allowed));
    Test("relative path is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = "Example App" }, []).Allowed));
    Test("UNC is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = @"\\server\share\Example App" }, []).Allowed));
    Test("device paths are blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = @"\\?\C:\Example App" }, []).Allowed));
    Test("parent traversal is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = appPath + @"\..\Example App" }, []).Allowed));
    Test("alternate data streams are blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = appPath + ":stream" }, []).Allowed));
    Test("prefix sibling is blocked", () => Assert(!policy.Evaluate(app with { InstallLocation = appsRoot + "-other\\Example App" }, []).Allowed));
    Test("name mismatch is blocked", () => Assert(!policy.Evaluate(app with { Name = "Different App" }, []).Allowed));
    Test("same folder used by another registration is blocked", () => Assert(!policy.Evaluate(app, [app, app with { Id = "other" }]).Allowed));
    Test("another app nested in target is blocked", () => Assert(!policy.Evaluate(app, [app, app with { Id = "other", InstallLocation = Path.Combine(appPath, "Child") }]).Allowed));
    Test("manager package cleanup is blocked", () => Assert(!policy.Evaluate(app with { Source = PackageSource.Winget }, []).Allowed));
    Test("protected registration cleanup is blocked", () => Assert(!policy.Evaluate(app with { Protected = true }, []).Allowed));
    Test("registration still present prevents deletion", () => { var result = new GuardedCleanup(policy, _ => true).Clean(app, [app], appPath); Assert(result.Contains("still reports")); Assert(Directory.Exists(appPath)); });
    Test("changed approved path prevents deletion", () => { var result = new GuardedCleanup(policy, _ => false).Clean(app, [app], appPath + "changed"); Assert(result.Contains("changed")); Assert(Directory.Exists(appPath)); });
    Test("nested junction is refused and outside files survive", () =>
    {
        var outside = Path.Combine(fixture, "Outside");
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "sentinel.txt"), "must survive");
        var link = Path.Combine(appPath, "linked");
        using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, ArgumentList = { "/c", "mklink", "/J", link, outside } })!;
        process.WaitForExit();
        Assert(process.ExitCode == 0, "Could not create test junction");
        Throws(() => new GuardedCleanup(policy, _ => false).Clean(app, [app], appPath));
        Assert(File.Exists(Path.Combine(outside, "sentinel.txt")));
        Directory.Delete(link, false);
    });
    Test("junction as installation folder is blocked", () =>
    {
        var link = Path.Combine(appsRoot, "Linked App");
        using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, ArgumentList = { "/c", "mklink", "/J", link, appPath } })!;
        process.WaitForExit();
        Assert(process.ExitCode == 0);
        Assert(!policy.Evaluate(app with { Name = "Linked App", InstallLocation = link }, []).Allowed);
        Directory.Delete(link, false);
    });
    Test("verified folder contents removed while sibling survives", () =>
    {
        File.WriteAllText(Path.Combine(appPath, "leftover.txt"), "test");
        var nested = Path.Combine(appPath, "nested"); Directory.CreateDirectory(nested);
        File.WriteAllText(Path.Combine(nested, "file.txt"), "test");
        var sibling = Path.Combine(appsRoot, "Sibling"); Directory.CreateDirectory(sibling);
        File.WriteAllText(Path.Combine(sibling, "sentinel.txt"), "must survive");
        var result = new GuardedCleanup(policy, _ => false).Clean(app, [app], appPath);
        Assert(result == "Verified leftover folder removed.", result);
        Assert(!Directory.Exists(appPath));
        Assert(File.Exists(Path.Combine(sibling, "sentinel.txt")));
    });
    Test("quoted uninstall command preserves arguments", () => { var (exe, args) = CommandPolicy.SplitRegisteredCommand("\"C:\\Program Files\\Example\\uninstall.exe\" /S"); Assert(exe == @"C:\Program Files\Example\uninstall.exe" && args == "/S"); });
    Test("ambiguous unquoted executable is blocked", () => Throws(() => CommandPolicy.SplitRegisteredCommand(@"C:\Program Files\Example\uninstall.exe /S")));
    Test("MSI uses verified product code, silent and no restart", () => { var c = CommandPolicy.Create(app with { Id = "{12345678-1234-1234-1234-123456789ABC}", WindowsInstaller = true }); Assert(c.FileName == "msiexec.exe" && c.Arguments.Contains("/qn") && c.Arguments.Contains("/norestart")); });
    Test("invalid MSI code is blocked", () => Throws(() => CommandPolicy.Create(app with { WindowsInstaller = true })));
    Test("quiet command is preferred", () => { var c = CommandPolicy.Create(app with { UninstallCommand = @"C:\Example\uninstall.exe", QuietCommand = @"C:\Example\uninstall.exe /S" }); Assert(c.Quiet && c.RawArguments == "/S"); });
    Test("unknown silent flags are never invented", () => { var c = CommandPolicy.Create(app with { UninstallCommand = @"C:\Example\uninstall.exe" }); Assert(!c.Quiet && c.RawArguments == ""); });
    Test("script host registration is blocked", () => Throws(() => CommandPolicy.Create(app with { UninstallCommand = @"C:\Windows\System32\cmd.exe /c del C:\file" })));
    Test("relative executable is blocked", () => Throws(() => CommandPolicy.Create(app with { UninstallCommand = "uninstall.exe /S" })));
    Test("WinGet uses exact ID and noninteractive args", () => { var c = CommandPolicy.Create(app with { Id = "Vendor.Package", Source = PackageSource.Winget }); Assert(c.Arguments.Contains("--exact") && c.Arguments.Contains("--disable-interactivity")); });
    Test("package argument injection is blocked", () => Throws(() => CommandPolicy.Create(app with { Id = "--all", Source = PackageSource.Chocolatey })));
    Test("Chocolatey all packages is blocked", () => Throws(() => CommandPolicy.Create(app with { Id = "all", Source = PackageSource.Chocolatey })));
    Test("package shell injection is blocked", () => Throws(() => CommandPolicy.Create(app with { Id = "pkg;rm -rf /", Source = PackageSource.Homebrew })));
    Test("Homebrew runs through WSL without shell", () => { var c = CommandPolicy.Create(app with { Id = "wget", Source = PackageSource.Homebrew }); Assert(c.FileName == "wsl.exe" && c.Arguments.Contains("--formula") && !c.Arguments.Contains("sh")); });
    Test("Store removal uses encoded validated command", () => { var c = CommandPolicy.Create(app with { Id = "Vendor.App_1.0.0.0_x64__abc", Source = PackageSource.Store }); Assert(c.Arguments.Contains("-EncodedCommand")); });
    Test("protected app uninstall is blocked", () => Throws(() => CommandPolicy.Create(app with { Protected = true })));
    Test("short folder identities are refused", () => Assert(!policy.Evaluate(app with { Name = "App", InstallLocation = Path.Combine(appsRoot, "App") }, []).Allowed));
    Test("deep target paths are refused", () => Assert(!policy.Evaluate(app with { InstallLocation = Path.Combine(appsRoot, "vendor", "nested", "Example App") }, []).Allowed));
    Test("excessive tree depth is refused before deletion", () =>
    {
        Directory.CreateDirectory(appPath);
        var deep = appPath;
        for (var i = 0; i < 66; i++) { deep = Path.Combine(deep, "d"); Directory.CreateDirectory(deep); }
        File.WriteAllText(Path.Combine(deep, "sentinel.txt"), "must survive");
        Throws(() => new GuardedCleanup(policy, _ => false).Clean(app, [app], appPath));
        Assert(File.Exists(Path.Combine(deep, "sentinel.txt")));
    });
    Test("MSI code is read from composite registry identity", () => { var c = CommandPolicy.Create(app with { Id = "LocalMachine|Registry64|{12345678-1234-1234-1234-123456789ABC}", WindowsInstaller = true }); Assert(c.Arguments[1] == "{12345678-1234-1234-1234-123456789ABC}"); });
    Test("missing uninstall command is refused", () => Throws(() => CommandPolicy.Create(app)));
    Test("non-executable command is refused", () => Throws(() => CommandPolicy.Create(app with { UninstallCommand = @"C:\Example\remove.bat" })));
    Test("hidden apps persist after reloading preferences", () =>
    {
        var path = Path.Combine(fixture, "preferences.json");
        var preferences = new HiddenApplications(path); preferences.Load();
        preferences.Set([app], true);
        var reloaded = new HiddenApplications(path); reloaded.Load();
        Assert(reloaded.Contains(app));
        reloaded.Set([app], false);
        var visible = new HiddenApplications(path); visible.Load();
        Assert(!visible.Contains(app));
    });
    Test("hidden entries are isolated by source", () =>
    {
        var preferences = new HiddenApplications(Path.Combine(fixture, "sources.json")); preferences.Load();
        preferences.Set([app], true);
        Assert(!preferences.Contains(app with { Source = PackageSource.Winget }));
    });
    Test("Store hidden state survives package version changes", () =>
    {
        var preferences = new HiddenApplications(Path.Combine(fixture, "store.json")); preferences.Load();
        preferences.Set([app with { Source = PackageSource.Store, Id = "Vendor.App_1.0.0.0_x64__publisher" }], true);
        Assert(preferences.Contains(app with { Source = PackageSource.Store, Id = "Vendor.App_2.0.0.0_x64__publisher" }));
    });
    Test("malformed preferences are preserved and writes refused", () =>
    {
        var path = Path.Combine(fixture, "invalid.json"); File.WriteAllText(path, "invalid JSON");
        var preferences = new HiddenApplications(path); preferences.Load();
        Assert(preferences.LoadError is not null);
        Throws(() => preferences.Set([app], true));
        Assert(File.ReadAllText(path) == "invalid JSON");
    });

    var mapRoot = Path.Combine(fixture, "DiskMap");
    var mapData = Path.Combine(mapRoot, "PersonalData");
    var mapContainer = Path.Combine(mapRoot, "Downloads");
    var mapProtected = Path.Combine(mapRoot, "SharedApp");
    Directory.CreateDirectory(mapData); Directory.CreateDirectory(mapContainer); Directory.CreateDirectory(mapProtected);
    var mapPolicy = new DiskDeletePolicy([mapProtected], [mapContainer]);
    Test("disk map drive root cannot be deleted", () => Assert(!mapPolicy.Evaluate(Path.GetPathRoot(mapData)!).Allowed));
    Test("disk map System32 is protected", () => Assert(!mapPolicy.Evaluate(@"C:\Windows\System32").Allowed));
    Test("disk map system component names are protected on every drive", () => Assert(!mapPolicy.Evaluate(Path.Combine(mapData, "System32")).Allowed));
    Test("disk map blocks UNC device traversal streams and ambiguous names", () => {
        foreach (var invalid in new[] { @"\\server\share\file", @"\\?\C:\Data", mapData + @"\..\PersonalData", mapData + ":stream", mapData + ".", mapData + " " }) Assert(!mapPolicy.Evaluate(invalid).Allowed, invalid);
    });
    Test("disk map protects installed app subtrees and their ancestors", () => { Assert(!mapPolicy.Evaluate(mapProtected).Allowed); Assert(!mapPolicy.Evaluate(mapRoot).Allowed); Assert(!mapPolicy.Evaluate(Path.Combine(mapProtected,"data")).Allowed); });
    Test("disk map protects known-folder containers but permits personal children", () => { Assert(!mapPolicy.Evaluate(mapContainer).Allowed); var child=Path.Combine(mapContainer,"photo.txt"); File.WriteAllText(child,"personal"); Assert(mapPolicy.Evaluate(child).Allowed); });
    Test("disk map blocks critical component files", () => { var critical=Path.Combine(mapData,"component.dll"); File.WriteAllText(critical,"test"); Assert(!mapPolicy.Evaluate(critical).Allowed); File.Delete(critical); });
    Test("disk map blocks hidden system and read-only files", () => {
        var f=Path.Combine(mapData,"attributes.txt");File.WriteAllText(f,"test");
        try { foreach(var attr in new[]{FileAttributes.Hidden,FileAttributes.System,FileAttributes.ReadOnly}){File.SetAttributes(f,attr);Assert(!mapPolicy.Evaluate(f).Allowed);} }
        finally {File.SetAttributes(f,FileAttributes.Normal);File.Delete(f);}
    });
    Test("disk map rejects changed reviewed content before quarantine", () => {
        var dir=Path.Combine(mapData,"Changing");Directory.CreateDirectory(dir);var f=Path.Combine(dir,"file.txt");File.WriteAllText(f,"one");
        var stamp=mapPolicy.Inspect(dir);File.AppendAllText(f," changed");Throws(()=>mapPolicy.Quarantine(stamp));Assert(Directory.Exists(dir));
    });
    Test("disk map quarantines only the reviewed item and preserves a sibling", () => {
        var f=Path.Combine(mapData,"selected.txt");var sibling=Path.Combine(mapData,"sibling.txt");File.WriteAllText(f,"selected");File.WriteAllText(sibling,"must survive");
        var moved=mapPolicy.Quarantine(mapPolicy.Inspect(f));Assert(!File.Exists(f));Assert(File.ReadAllText(moved)=="selected");Assert(File.ReadAllText(sibling)=="must survive");File.Move(moved,f);
    });
    Test("disk map rejects protected nested content before any rename", () => {
        var dir=Path.Combine(mapData,"WithComponents");Directory.CreateDirectory(dir);File.WriteAllText(Path.Combine(dir,"important.sys"),"protected");Throws(()=>mapPolicy.Inspect(dir));Assert(Directory.Exists(dir));
    });
    Test("disk map rejects a nested junction without touching its destination", () => {
        var dir=Path.Combine(mapData,"WithLink");Directory.CreateDirectory(dir);var link=Path.Combine(dir,"link");
        using var process=System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,ArgumentList={"/c","mklink","/J",link,mapProtected}})!;process.WaitForExit();Assert(process.ExitCode==0);
        Throws(()=>mapPolicy.Inspect(dir));Assert(Directory.Exists(mapProtected));Directory.Delete(link);
    });
    Console.WriteLine($"\n{passed} tests passed. No installed software was uninstalled.");
}
finally
{
    // Only remove known fixtures, after resolving and checking the complete target path.
    var resolved = Path.GetFullPath(fixture);
    var tempRoot = Path.GetFullPath(fixtureParent);
    if (CleanupPolicy.IsChild(resolved, Path.TrimEndingDirectorySeparator(tempRoot)) && Path.GetFileName(resolved).StartsWith("system69-tests-"))
    {
        void RemoveFixture(string path)
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(path))
            {
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    if ((attributes & FileAttributes.ReparsePoint) == 0) RemoveFixture(entry);
                    Directory.Delete(entry, false);
                }
                else File.Delete(entry);
            }
        }
        RemoveFixture(resolved);
        Directory.Delete(resolved, false);
    }
}
