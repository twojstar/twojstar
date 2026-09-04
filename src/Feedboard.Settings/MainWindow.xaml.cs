using Feedboard.Models;
using Feedboard.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;
using System.ComponentModel;
using Windows.Storage.Pickers;

namespace Feedboard.Settings;

public sealed partial class MainWindow : Window
{
    private readonly FeedStore _store = new();
    private readonly AppSettingsStore _settingsStore = new();
    private readonly FeedDiscovery _feedDiscovery = new();
    private bool _isReloading;
    private readonly Dictionary<string, int> _urlEditGenerations = new(StringComparer.Ordinal);
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
            var existing = Feeds.ToDictionary(row => row.Id, StringComparer.Ordinal);
            Feeds.Clear();
            foreach (var feed in await _store.LoadAsync())
            {
                if (existing.TryGetValue(feed.StableId, out var row))
                {
                    row.UpdateSource(feed);
                    Feeds.Add(row);
                }
                else
                {
                    Feeds.Add(new FeedRow(feed));
                }
            }

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

    private async void TestFeed_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not FeedRow row) return;
        await RunUiOperationAsync(async () =>
        {
            var error = await ProbeFeedAsync(row);
            StatusText.Text = error is null ? $"{row.DisplayName} is healthy." : $"{row.DisplayName}: {error}";
        });
    }

    private async void RefreshStatus_Click(object sender, RoutedEventArgs e)
    {
        await RunUiOperationAsync(async () =>
        {
            var enabled = Feeds.Where(row => row.Enabled).ToList();
            if (enabled.Count == 0) { StatusText.Text = "No enabled feeds to test."; return; }
            using var gate = new SemaphoreSlim(4);
            var results = await Task.WhenAll(enabled.Select(async row =>
            {
                await gate.WaitAsync();
                try { return await ProbeFeedAsync(row); }
                finally { gate.Release(); }
            }));
            StatusText.Text = $"{results.Count(error => error is null)}/{enabled.Count} enabled feeds healthy.";
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
            await _store.SetTitleAsync(row.Id, savedName);
            await ReloadAsync();
            StatusText.Text = string.IsNullOrWhiteSpace(savedName)
                ? "Custom feed name cleared."
                : $"Renamed feed to {savedName}.";
        });
    }

    private async void EditFeedUrl_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not FeedRow row) return;
        await RunUiOperationAsync(async () =>
        {
            var root = (Content as FrameworkElement)?.XamlRoot;
            if (root is null) throw new InvalidOperationException("Settings window is not ready.");

            var input = new TextBox
            {
                Text = row.Url,
                PlaceholderText = "Website or feed URL",
                MinWidth = 420
            };
            var dialog = new ContentDialog
            {
                Title = "Edit feed URL",
                Content = input,
                PrimaryButtonText = "Save",
                CloseButtonText = "Cancel",
                DefaultButton = ContentDialogButton.Primary,
                XamlRoot = root
            };

            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

            var generation = _urlEditGenerations.TryGetValue(row.Id, out var current) ? current + 1 : 1;
            _urlEditGenerations[row.Id] = generation;
            StatusText.Text = "Looking for a feed…";
            var feedUrl = await _feedDiscovery.ResolveFeedUrlAsync(input.Text.Trim());
            if (!_urlEditGenerations.TryGetValue(row.Id, out var latest) || latest != generation) return;
            await _store.SetUrlAsync(row.Id, feedUrl);
            await ReloadAsync();
            Feeds.FirstOrDefault(feed => feed.Id == row.Id)?.SetHealth("Healthy");
            StatusText.Text = $"Feed URL updated to {new Uri(feedUrl).Host}.";
        });
    }
    private async Task<string?> ProbeFeedAsync(FeedRow row)
    {
        await row.ProbeGate.WaitAsync();
        try
        {
            row.HealthText = "Checking…";
            try
            {
                await _feedDiscovery.ResolveFeedUrlAsync(row.Url);
                row.SetHealth("Healthy");
                return null;
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or HttpRequestException or OperationCanceledException or IOException)
            {
                var error = ex is OperationCanceledException ? "Feed test timed out." : ex.Message;
                row.SetHealth("Problem", error);
                return error;
            }
        }
        finally
        {
            row.ProbeGate.Release();
        }
    }

    private async void RemoveFeed_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is not FeedRow row) return;
        await RunUiOperationAsync(async () =>
        {
            await _store.RemoveAsync(row.Id);
            await ReloadAsync();
        });
    }

    private async void Enabled_Toggled(object sender, RoutedEventArgs e)
    {
        if (_isReloading || (sender as FrameworkElement)?.DataContext is not FeedRow row || sender is not ToggleSwitch toggle) return;
        await RunUiOperationAsync(async () =>
        {
            await _store.SetEnabledAsync(row.Id, toggle.IsOn);
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

public sealed class FeedRow : INotifyPropertyChanged
{
    private string _healthText = "Not tested";
    private DateTimeOffset? _lastCheckedAt;
    private string? _lastError;
    internal SemaphoreSlim ProbeGate { get; } = new(1, 1);

    public FeedRow(FeedSource source)
    {
        Id = source.StableId;
        UpdateSource(source);
    }

    public void UpdateSource(FeedSource source)
    {
        var urlChanged = !string.IsNullOrEmpty(Url) && !string.Equals(Url, source.Url, StringComparison.OrdinalIgnoreCase);
        Url = source.Url;
        CustomTitle = source.Title;
        DisplayName = source.Title ?? source.Url;
        Enabled = source.Enabled;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Url)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CustomTitle)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(DisplayName)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Enabled)));
        if (urlChanged)
        {
            HealthText = "Not tested";
            LastError = null;
            LastCheckedAt = null;
        }
    }

    public string Id { get; }
    public string Url { get; private set; } = string.Empty;
    public string? CustomTitle { get; private set; }
    public string DisplayName { get; private set; } = string.Empty;
    public bool Enabled { get; private set; }
    public DateTimeOffset? LastCheckedAt
    {
        get => _lastCheckedAt;
        private set { _lastCheckedAt = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(LastCheckedText))); }
    }
    public string LastCheckedText => LastCheckedAt is null ? "Never checked" : $"Checked {LastCheckedAt.Value.LocalDateTime:HH:mm}";
    public string? LastError
    {
        get => _lastError;
        private set { _lastError = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(LastError))); }
    }
    public void SetHealth(string text, string? error = null)
    {
        HealthText = text;
        LastError = error;
        LastCheckedAt = DateTimeOffset.Now;
    }
    public string HealthText
    {
        get => _healthText;
        set
        {
            if (string.Equals(_healthText, value, StringComparison.Ordinal)) return;
            _healthText = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(HealthText)));
        }
    }
    public event PropertyChangedEventHandler? PropertyChanged;
}
