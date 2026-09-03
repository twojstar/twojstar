using Feedboard.Interop;
using Feedboard.Services;
using Microsoft.Windows.Widgets.Providers;
using System.Runtime.InteropServices;

namespace Feedboard;

public static class Program
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [MTAThread]
    public static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "-RegisterProcessAsComServer")
        {
            RunWidgetProvider();
            return;
        }

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

        if (GetConsoleWindow() != IntPtr.Zero)
        {
            Console.WriteLine("Feedboard widget provider registered. Press ENTER to exit.");
            Console.ReadLine();
        }
        else
        {
            manager.ExitWaitHandle.WaitOne();
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
