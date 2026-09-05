using Feedboard.Interop;
using Feedboard.Services;
using Microsoft.Windows.Widgets.Providers;
using System.Runtime.InteropServices;

namespace Feedboard;

public static class Program
{
    private const uint AttachParentProcess = 0xFFFFFFFF;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(uint processId);

    [MTAThread]
    public static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "-RegisterProcessAsComServer")
        {
            RunWidgetProvider();
            return;
        }

        AttachParentConsole();

        if (args.Length > 0 && args[0].Equals("feeds", StringComparison.OrdinalIgnoreCase))
        {
            RunFeedCommand(args.Skip(1).ToArray()).GetAwaiter().GetResult();
            return;
        }

        Console.WriteLine("Feedboard widget provider");
        Console.WriteLine("  feeds list");
        Console.WriteLine("  feeds add <url>");
        Console.WriteLine("  feeds import <file.opml>");
        Console.WriteLine("  feeds export <file.opml>");
    }

    private static void RunWidgetProvider()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();
        using var manager = RegistrationManager<WidgetProvider>.RegisterProvider();

        _ = WidgetManager.GetDefault().GetWidgetIds();
        manager.ExitWaitHandle.WaitOne();
    }

    private static void AttachParentConsole()
    {
        if (!AttachConsole(AttachParentProcess))
        {
            return;
        }

        var stdout = Console.OpenStandardOutput();
        if (stdout != Stream.Null)
        {
            Console.SetOut(new StreamWriter(stdout) { AutoFlush = true });
        }

        var stderr = Console.OpenStandardError();
        if (stderr != Stream.Null)
        {
            Console.SetError(new StreamWriter(stderr) { AutoFlush = true });
        }
    }

    private static async Task RunFeedCommand(string[] args)
    {
        var store = new FeedStore();
        if (args.Length == 0)
        {
            Console.Error.WriteLine("Missing feed command.");
            return;
        }

        switch (args[0].ToLowerInvariant())
        {
            case "list":
                foreach (var source in await store.LoadAsync())
                {
                    Console.WriteLine($"{(source.Enabled ? "[x]" : "[ ]")} {source.Title ?? source.Url}  {source.Url}");
                }
                break;

            case "add" when args.Length >= 2:
                await store.AddAsync(args[1]);
                Console.WriteLine("Feed added.");
                break;

            case "import" when args.Length >= 2:
                var imported = Opml.Import(await File.ReadAllTextAsync(args[1]));
                await store.MergeAsync(imported);
                Console.WriteLine($"Imported {imported.Count} feed(s).");
                break;

            case "export" when args.Length >= 2:
                var sources = await store.LoadAsync();
                await File.WriteAllTextAsync(args[1], Opml.Export(sources));
                Console.WriteLine($"Exported {sources.Count} feed(s).");
                break;

            default:
                Console.Error.WriteLine("Unknown or incomplete feed command.");
                break;
        }
    }
}
