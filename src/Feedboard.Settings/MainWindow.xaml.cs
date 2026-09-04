using Feedboard.Models;
using Feedboard.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;
using Windows.Storage.Pickers;

namespace Feedboard.Settings;

public sealed partial class MainWindow : Window
{
    private readonly FeedStore _store = new();
    private readonly AppSettingsStore _settingsStore = new();
    private readonly FeedDiscovery _feedDiscovery = new();
    private bool _isReloading;
    public ObservableCollection<FeedRow> Feeds { get; } = new();

    public MainWindow()
    {
        InitializeComponent();
        _ = RunUiOperationAsync(ReloadAsync);
    }

    private async Task ReloadAsync()
    {
        _isReloading = true;
        try
        {
            Feeds.Clear();
            foreach (var feed in await _store.LoadAsync()) Feeds.Add(new FeedRow(feed));

            var settings = await _settingsStore.LoadAsync();
            RefreshIntervalBox.SelectedItem = RefreshIntervalBox.Items
                .OfType<ComboBoxItem>()
                .FirstOrDefault(item => string.Equals(item.Tag?.ToString(), settings.RefreshIntervalMinutes.ToString(), StringComparison.Ordinal));

            StatusText.Text = $"{Feeds.Count} feed(s)";
        }
        finally
        {
            _isReloading = false;
        }
    }

    private async Task RunUiOperationAsync(Func<Task> operation)
    {
        try
        {
            await operation();
        }
        catch (ArgumentException ex)
        {
            StatusText.Text = ex.Message;
        }
        catch (InvalidOperationException ex)
        {
            StatusText.Text = ex.Message;
        }
        catch (HttpRequestException ex)
        {
            StatusText.Text = $"Feed request failed: {ex.Message}";
        }
        catch (OperationCanceledException)
        {
            StatusText.Text = "Feed request timed out.";
        }
        catch (IOException ex)
        {
            StatusText.Text = $"File error: {ex.Message}";
        }
        catch (UnauthorizedAccessException ex)
        {
            StatusText.Text = $"Access denied: {ex.Message}";
        }
    }

    private async void AddFeed_Click(object sender, RoutedEventArgs e)
    {
        await RunUiOperationAsync(async () =>
        {
            StatusText.Text = "Looking for a feed…";
            var feedUrl = await _feedDiscovery.ResolveFeedUrlAsync(FeedUrlBox.Text.Trim());
            await _store.AddAsync(feedUrl);
            FeedUrlBox.Text = string.Empty;
            await ReloadAsync();
            StatusText.Text = $"Added {new Uri(feedUrl).Host}.";
        });
    }

    private async void RenameFeed_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not FeedRow row) return;
        await RunUiOperationAsync(async () =>
        {
            var root = (Content as FrameworkElement)?.XamlRoot;
            if (root is null) throw new InvalidOperationException("Settings window is not ready.");

            var input = new TextBox
            {
                Text = row.CustomTitle ?? string.Empty,
                PlaceholderText = "Custom feed name (optional)",
                MaxLength = 120,
                MinWidth = 320
            };
            var dialog = new ContentDialog
            {
                Title = "Rename feed",
                Content = input,
                PrimaryButtonText = "Save",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Primary,
                XamlRoot = root
            };

            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

            var savedName = input.Text.Trim();
            await _store.SetTitleAsync(row.Url, savedName);
            await ReloadAsync();
            StatusText.Text = string.IsNullOrWhiteSpace(savedName)
                ? "Custom feed name cleared."
                : $"Renamed feed to {savedName}.";
        });
    }

    private async void RemoveFeed_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not FeedRow row) return;
        await RunUiOperationAsync(async () =>
        {
            await _store.RemoveAsync(row.Url);
            await ReloadAsync();
        });
    }

    private async void Enabled_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isReloading || (sender as FrameworkElement)?.DataContext is not FeedRow row || sender is not ToggleSwitch toggle) return;
        await RunUiOperationAsync(async () =>
        {
            await _store.SetEnabledAsync(row.Url, toggle.IsOn);
            await ReloadAsync();
        });
    }

    private async void RefreshInterval_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isReloading || RefreshIntervalBox.SelectedItem is not ComboBoxItem item || !int.TryParse(item.Tag?.ToString(), out var minutes)) return;

        await RunUiOperationAsync(async () =>
        {
            await _settingsStore.SetRefreshIntervalAsync(minutes);
            StatusText.Text = $"Refresh interval set to {minutes} minutes.";
        });
    }

    private async void ImportOpml_Click(object sender, RoutedEventArgs e)
    {
        await RunUiOperationAsync(async () =>
        {
            var picker = new FileOpenPicker();
            picker.FileTypeFilter.Add(".opml");
            picker.FileTypeFilter.Add(".xml");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
            var file = await picker.PickSingleFileAsync();
            if (file is null) return;
            await _store.MergeAsync(Opml.Import(await File.ReadAllTextAsync(file.Path)));
            await ReloadAsync();
        });
    }

    private async void ExportOpml_Click(object sender, RoutedEventArgs e)
    {
        await RunUiOperationAsync(async () =>
        {
            var picker = new FileSavePicker { SuggestedFileName = "feedboard-subscriptions" };
            picker.FileTypeChoices.Add("OPML", new[] { ".opml" });
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
            var file = await picker.PickSaveFileAsync();
            if (file is null) return;
            await File.WriteAllTextAsync(file.Path, Opml.Export(await _store.LoadAsync()));
            StatusText.Text = "OPML exported.";
        });
    }
}

public sealed class FeedRow
{
    public FeedRow(FeedSource source)
    {
        Url = source.Url;
        CustomTitle = source.Title;
        DisplayName = source.Title ?? source.Url;
        Enabled = source.Enabled;
    }

    public string Url { get; }
    public string? CustomTitle { get; }
    public string DisplayName { get; }
    public bool Enabled { get; }
}
