using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System69.App.Services;
using System69.Core;

Console.InputEncoding = new UTF8Encoding(false);
Console.OutputEncoding = new UTF8Encoding(false);
var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
options.Converters.Add(new JsonStringEnumConverter());
var data = args.Length > 0 ? args[0] : throw new ArgumentException("App data folder required.");
var inventory = new InventoryService();
var cleanup = new CleanupService();
var hidden = new HiddenApplications(Path.Combine(data, "hidden-apps.json"));
hidden.Load();
List<InstalledApp> apps = [];
var prepared = new Dictionary<string, Prepared>();
var diskReviews = new Dictionary<string, (DiskStamp Stamp, DateTime Created)>();
var diskQuarantines = new Dictionary<string, (string Path, DiskStamp Stamp)>();
bool halted = false;
void Send(object value) => Console.WriteLine(JsonSerializer.Serialize(value, options));
string Key(InstalledApp a) => a.Source + ":" + a.Id;
object Row(InstalledApp a) => new { key = Key(a), a.Id, a.Name, a.Version, a.Publisher, a.Source, a.SourceLabel, a.SizeLabel, a.SizeBytes, a.SupportsQuiet, a.Protected, a.InstallLocation, hidden = hidden.Contains(a) };
while (await Console.In.ReadLineAsync() is { } line)
{
    long id = 0;
    try
    {
        using var doc = JsonDocument.Parse(line);
        id = doc.RootElement.GetProperty("id").GetInt64();
        var action = doc.RootElement.GetProperty("action").GetString();
        var payload = doc.RootElement.GetProperty("payload");
        object? result;
        switch (action)
        {
            case "diskPolicy":
                result = DiskProtection.Create(data).Evaluate(payload.GetProperty("path").GetString() ?? "");
                break;
            case "diskReview":
                if (halted) throw new InvalidOperationException("Resolve the previous operation before deleting files.");
                diskReviews.Clear();
                var stamp = DiskProtection.Create(data).Inspect(payload.GetProperty("path").GetString() ?? "");
                var diskToken = Guid.NewGuid().ToString("N");
                diskReviews[diskToken] = (stamp, DateTime.UtcNow);
                result = new { token = diskToken, path = stamp.Path, directory = stamp.Directory, entries = stamp.Entries, bytes = stamp.Bytes };
                break;
            case "diskQuarantine":
                if (halted) throw new InvalidOperationException("Resolve the previous operation before deleting files.");
                if (!diskReviews.Remove(payload.GetProperty("token").GetString() ?? "", out var diskReview) || DateTime.UtcNow - diskReview.Created > TimeSpan.FromMinutes(2)) throw new InvalidOperationException("Deletion review expired. Review again.");
                var moved = DiskProtection.Create(data).Quarantine(diskReview.Stamp);
                diskQuarantines[payload.GetProperty("token").GetString()!] = (moved, diskReview.Stamp);
                result = new { path = moved, original = diskReview.Stamp.Path };
                break;
            case "diskRestore":
                var restoreToken = payload.GetProperty("token").GetString() ?? "";
                if (!diskQuarantines.TryGetValue(restoreToken, out var restore)) throw new InvalidOperationException("No recoverable item in this session.");
                var safe = DiskProtection.Create(data).Evaluate(restore.Path);
                if (!safe.Allowed) throw new IOException("Recovery requires manual review: " + restore.Path + ". " + safe.Reason);
                if (File.Exists(restore.Stamp.Path) || Directory.Exists(restore.Stamp.Path)) throw new IOException("Original path is occupied. Remaining content: " + restore.Path);
                if (restore.Stamp.Directory) Directory.Move(restore.Path, restore.Stamp.Path); else File.Move(restore.Path, restore.Stamp.Path);
                diskQuarantines.Remove(restoreToken);
                result = true;
                break;
            case "diskForget":
                diskQuarantines.Remove(payload.GetProperty("token").GetString() ?? "");
                result = true;
                break;
            case "scan":
                prepared.Clear();
                apps = await inventory.ScanAsync(payload.TryGetProperty("brew", out var brew) && brew.GetBoolean(), message => Send(new { @event = "progress", message }), CancellationToken.None);
                result = new { apps = apps.Select(Row), notices = inventory.Notices.Concat(hidden.LoadError is { } error ? [error] : Array.Empty<string>()) };
                break;
            case "hide":
                var keys = payload.GetProperty("keys").EnumerateArray().Select(x => x.GetString()).ToHashSet();
                hidden.Set(apps.Where(a => keys.Contains(Key(a))), payload.GetProperty("hide").GetBoolean());
                prepared.Clear();
                result = apps.Select(Row);
                break;
            case "prepare":
                if (halted) throw new InvalidOperationException("The queue is stopped for a restart or a still-running uninstaller. Resolve that operation and restart System69.");
                prepared.Clear();
                var requested = payload.GetProperty("keys").EnumerateArray().Select(x => x.GetString()).ToHashSet();
                var silent = payload.GetProperty("silent").GetBoolean();
                var advanced = payload.GetProperty("advanced").GetBoolean();
                var reviews = new List<object>();
                foreach (var a in apps.Where(a => requested.Contains(Key(a))))
                {
                    try
                    {
                        if (hidden.Contains(a)) throw new InvalidOperationException("Hidden applications cannot be queued.");
                        if (a.Name.StartsWith("Node.js", StringComparison.OrdinalIgnoreCase) || new[] { "nodejs", "nodejs.install", "nodejs-lts", "OpenJS.NodeJS", "OpenJS.NodeJS.LTS" }.Contains(a.Id, StringComparer.OrdinalIgnoreCase))
                            throw new InvalidOperationException("Use Node.js runtimes to remove this installation after checking PATH and running processes.");
                        UninstallCommand? fallback = null;
                        if (a.Source is PackageSource.Windows or PackageSource.Winget or PackageSource.Chocolatey)
                        {
                            try { fallback = CommandPolicy.Create(a, false); }
                            catch (InvalidOperationException) { /* No safe interactive command is registered. */ }
                        }
                        UninstallCommand command;
                        try { command = CommandPolicy.Create(a, silent); }
                        catch (InvalidOperationException) when (fallback is not null) { command = fallback; }
                        if (!command.Quiet) fallback = null;
                        var decision = cleanup.Policy.Evaluate(a, apps);
                        var token = Guid.NewGuid().ToString("N");
                        prepared[token] = new(a, command, fallback, advanced ? decision : new(false, "Advanced cleanup is off."), DateTime.UtcNow);
                        string Describe(UninstallCommand c) => c.FileName + " " + (c.RawArguments ?? string.Join(" ", c.Arguments));
                        reviews.Add(new { key = Key(a), a.Name, a.SourceLabel, token, eligible = true, mode = command.Quiet ? fallback is null ? "Silent requested" : "Silent preferred; interactive fallback" : "Interactive uninstaller", command = Describe(command) + (fallback is null ? "" : "\nFallback: " + Describe(fallback)), cleanup = advanced && decision.Allowed ? decision.CanonicalPath : advanced ? "Skipped: " + decision.Reason : "Off" });
                    }
                    catch (Exception ex) { reviews.Add(new { key = Key(a), a.Name, a.SourceLabel, eligible = false, reason = ex.Message }); }
                }
                result = reviews;
                break;
            case "discard":
                prepared.Clear();
                result = true;
                break;
            case "execute":
                if (halted) throw new InvalidOperationException("Queue stopped. Resolve the previous operation and restart System69.");
                var approvalToken = payload.GetProperty("token").GetString() ?? "";
                if (!prepared.Remove(approvalToken, out var item) || DateTime.UtcNow - item.Created > TimeSpan.FromMinutes(15)) throw new InvalidOperationException("Review expired. Review the queue again.");
                if (hidden.Contains(item.App)) throw new InvalidOperationException("This application is hidden.");
                if (item.App.Source == PackageSource.Windows)
                {
                    var freshApp = InventoryService.ReadWindowsInventory().FirstOrDefault(a => Key(a) == Key(item.App));
                    if (freshApp is null || freshApp != item.App) throw new InvalidOperationException("Application registration changed. Refresh and review again.");
                }
                try
                {
                    var usedFallback = false;
                    async Task<ProcessResult> Run(UninstallCommand c) => await ProcessRunner.RunAsync(c.FileName, c.Arguments, CancellationToken.None, rawArguments: c.RawArguments, quiet: c.Quiet);
                    ProcessResult run;
                    try { run = await Run(item.Command); }
                    catch (System.ComponentModel.Win32Exception ex) when (item.Fallback is not null && ex.NativeErrorCode != 1223)
                    { usedFallback = true; run = await Run(item.Fallback); }
                    if (!usedFallback && item.Fallback is not null && run.ExitCode is not (0 or 1641 or 3010 or 1602 or 1223 or 1618)
                        && (item.App.Source != PackageSource.Windows || InventoryService.IsRegistered(item.App)))
                    {
                        Send(new { @event = "progress", message = $"Silent uninstall failed for {item.App.Name}. Opening the interactive uninstaller." });
                        usedFallback = true;
                        run = await Run(item.Fallback);
                    }
                    var restart = (item.App.WindowsInstaller || item.App.Source == PackageSource.Chocolatey) && run.ExitCode is 1641 or 3010;
                    var success = run.ExitCode == 0 || restart;
                    var detail = (usedFallback ? "Interactive fallback used. " : "") + (success ? "Uninstaller reported success." : $"Exit {run.ExitCode}. {run.Error} {run.Output}");
                    if (restart) { halted = true; detail = "Restart Windows before continuing. Cleanup skipped."; }
                    else if (success && item.Cleanup.Allowed)
                        detail = cleanup.Clean(item.App, InventoryService.ReadWindowsInventory(), item.Cleanup.CanonicalPath!);
                    else if (success && item.App.Source == PackageSource.Windows && InventoryService.IsRegistered(item.App))
                        detail = "Registration remains. Refresh or finish the uninstaller prompts.";
                    result = new { success, rebootRequired = restart, halt = restart, detail, exitCode = run.ExitCode };
                }
                catch (ProcessStillRunningException ex) { halted = true; result = new { success = false, halt = true, detail = ex.Message }; }
                break;
            default: throw new InvalidOperationException("Unknown bridge action.");
        }
        Send(new { id, ok = true, value = result });
    }
    catch (Exception ex) { Send(new { id, ok = false, error = ex.Message }); }
}
sealed record Prepared(InstalledApp App, UninstallCommand Command, UninstallCommand? Fallback, CleanupDecision Cleanup, DateTime Created);
