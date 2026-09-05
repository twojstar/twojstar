using Feedboard.Models;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Feedboard.Services;

public sealed partial class FeedClient
{
    private const int MaxFeedBytes = 2 * 1024 * 1024;
    private const int MaxSiteHtmlBytes = 512 * 1024;
    private static readonly TimeSpan BodyTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SiteIconCacheTtl = TimeSpan.FromHours(24);
    private static readonly HttpClient Http = CreateHttpClient();
    private static readonly ConcurrentDictionary<string, FeedCacheEntry> FeedCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, SiteIconCacheEntry> SiteIconCache = new(StringComparer.OrdinalIgnoreCase);

    public async Task<IReadOnlyList<FeedArticle>> LoadAsync(IEnumerable<FeedSource> sources, CancellationToken cancellationToken = default)
    {
        var tasks = sources.Where(x => x.Enabled).Take(32).Select(source => LoadSingleSafeAsync(source, cancellationToken));
        var results = await Task.WhenAll(tasks);
        return results.SelectMany(x => x)
            .GroupBy(x => x.Id, StringComparer.Ordinal)
            .Select(group => group.OrderByDescending(x => x.Published ?? DateTimeOffset.MinValue).First())
            .OrderByDescending(x => x.Published ?? DateTimeOffset.MinValue)
            .ThenBy(x => x.FeedTitle, StringComparer.CurrentCultureIgnoreCase)
            .Take(50)
            .ToList();
    }

    private static async Task<IReadOnlyList<FeedArticle>> LoadSingleSafeAsync(FeedSource source, CancellationToken cancellationToken)
    {
        FeedCache.TryGetValue(source.Url, out var cached);
        if (cached?.RetryAfter is { } retryAfter && retryAfter > DateTimeOffset.UtcNow)
        {
            return cached.Articles;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, source.Url);
            if (!string.IsNullOrWhiteSpace(cached?.ETag)) request.Headers.IfNoneMatch.ParseAdd(cached.ETag);
            if (cached?.LastModified is { } lastModified) request.Headers.IfModifiedSince = lastModified;

            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotModified && cached is not null)
            {
                FeedCache[source.Url] = cached with { FailureCount = 0, RetryAfter = null };
                return cached.Articles;
            }

            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is > MaxFeedBytes) return RegisterFeedFailure(source.Url, cached);

            using var bodyCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            bodyCts.CancelAfter(BodyTimeout);
            await using var stream = await response.Content.ReadAsStreamAsync(bodyCts.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[16 * 1024];
            while (true)
            {
                var read = await stream.ReadAsync(chunk.AsMemory(0, chunk.Length), bodyCts.Token);
                if (read == 0) break;
                if (buffer.Length + read > MaxFeedBytes) return RegisterFeedFailure(source.Url, cached);
                await buffer.WriteAsync(chunk.AsMemory(0, read), bodyCts.Token);
            }

            buffer.Position = 0;
            var finalUrl = response.RequestMessage?.RequestUri?.ToString() ?? source.Url;
            var parseSource = source with { Url = finalUrl };
            IReadOnlyList<FeedArticle> articles;
            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (string.Equals(mediaType, "application/feed+json", StringComparison.OrdinalIgnoreCase) || string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase))
            {
                using var json = await JsonDocument.ParseAsync(buffer, cancellationToken: bodyCts.Token);
                articles = ParseJsonDocument(parseSource, json.RootElement);
            }
            else
            {
                try
                {
                    articles = ParseDocument(parseSource, XDocument.Load(buffer, LoadOptions.None));
                }
                catch (System.Xml.XmlException)
                {
                    buffer.Position = 0;
                    using var json = await JsonDocument.ParseAsync(buffer, cancellationToken: bodyCts.Token);
                    articles = ParseJsonDocument(parseSource, json.RootElement);
                }
            }

            var fallbackIcon = FaviconFrom(parseSource.Url);
            if (articles.Any(article => string.Equals(article.FaviconUrl, fallbackIcon, StringComparison.OrdinalIgnoreCase)))
            {
                var discoveredIcon = await GetSiteIconAsync(parseSource.Url, cancellationToken);
                if (!string.IsNullOrWhiteSpace(discoveredIcon))
                {
                    articles = articles.Select(article => string.Equals(article.FaviconUrl, fallbackIcon, StringComparison.OrdinalIgnoreCase)
                        ? article with { FaviconUrl = discoveredIcon }
                        : article).ToList();
                }
            }

            FeedCache[source.Url] = new FeedCacheEntry(
                articles,
                response.Headers.ETag?.ToString(),
                response.Content.Headers.LastModified,
                FailureCount: 0,
                RetryAfter: null);
            return articles;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException or JsonException or FormatException)
        {
            Trace.TraceWarning($"Feedboard feed refresh failed for {source.Url}: {ex.Message}");
            return RegisterFeedFailure(source.Url, cached);
        }
    }

    private static IReadOnlyList<FeedArticle> RegisterFeedFailure(string feedUrl, FeedCacheEntry? cached)
    {
        if (cached is null) return Array.Empty<FeedArticle>();
        var failures = Math.Min(cached.FailureCount + 1, 5);
        var delayMinutes = Math.Min(5 * (1 << (failures - 1)), 60);
        FeedCache[feedUrl] = cached with
        {
            FailureCount = failures,
            RetryAfter = DateTimeOffset.UtcNow.AddMinutes(delayMinutes)
        };
        return cached.Articles;
    }

    private static async Task<string?> GetSiteIconAsync(string feedUrl, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(feedUrl, UriKind.Absolute, out var feedUri)) return null;
        var origin = feedUri.GetLeftPart(UriPartial.Authority) + "/";
        var now = DateTimeOffset.UtcNow;
        while (true)
        {
            if (SiteIconCache.TryGetValue(origin, out var cached) && cached.ExpiresAt > now)
            {
                return await cached.Value.Value.WaitAsync(cancellationToken);
            }

            var replacement = new SiteIconCacheEntry(
                new Lazy<Task<string?>>(() => DiscoverSiteIconAsync(origin), LazyThreadSafetyMode.ExecutionAndPublication),
                now + SiteIconCacheTtl);
            if (cached is null)
            {
                if (SiteIconCache.TryAdd(origin, replacement)) return await replacement.Value.Value.WaitAsync(cancellationToken);
            }
            else if (SiteIconCache.TryUpdate(origin, replacement, cached))
            {
                return await replacement.Value.Value.WaitAsync(cancellationToken);
            }
        }
    }

    private static async Task<string?> DiscoverSiteIconAsync(string origin)
    {
        try
        {
            using var timeoutCts = new CancellationTokenSource(BodyTimeout);
            using var request = new HttpRequestMessage(HttpMethod.Get, origin);
            request.Headers.Accept.Clear();
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > MaxSiteHtmlBytes) return null;

            await using var stream = await response.Content.ReadAsStreamAsync(timeoutCts.Token);
            using var raw = new MemoryStream();
            var chunk = new byte[16 * 1024];
            while (true)
            {
                var read = await stream.ReadAsync(chunk.AsMemory(0, chunk.Length), timeoutCts.Token);
                if (read == 0) break;
                if (raw.Length + read > MaxSiteHtmlBytes) return null;
                await raw.WriteAsync(chunk.AsMemory(0, read), timeoutCts.Token);
            }

            raw.Position = 0;
            using var reader = new StreamReader(raw, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 4096, leaveOpen: false);
            var html = await reader.ReadToEndAsync(timeoutCts.Token);

            // This deliberately uses a bounded lightweight tokenizer rather than a full HTML DOM parser.
            foreach (Match tag in LinkTagRegex().Matches(html))
            {
                var value = tag.Value;
                var rel = AttributeValue(value, "rel");
                if (rel is null || !rel.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(token => token.Equals("icon", StringComparison.OrdinalIgnoreCase))) continue;
                var href = AttributeValue(value, "href");
                var resolved = ResolveUrl(response.RequestMessage?.RequestUri?.ToString() ?? origin, WebUtility.HtmlDecode(href));
                if (!string.IsNullOrWhiteSpace(resolved)) return resolved;
            }
        }
        catch (OperationCanceledException ex)
        {
            Trace.TraceWarning($"Feedboard site icon discovery timed out for {origin}: {ex.Message}");
        }
        catch (HttpRequestException ex)
        {
            Trace.TraceWarning($"Feedboard site icon discovery failed for {origin}: {ex.Message}");
        }
        catch (IOException ex)
        {
            Trace.TraceWarning($"Feedboard site icon discovery I/O failed for {origin}: {ex.Message}");
        }

        return null;
    }

    private static string? AttributeValue(string tag, string name)
    {
        foreach (Match match in HtmlAttributeRegex().Matches(tag))
        {
            if (!match.Groups[1].Value.Equals(name, StringComparison.OrdinalIgnoreCase)) continue;
            if (match.Groups[3].Success) return match.Groups[3].Value;
            if (match.Groups[4].Success) return match.Groups[4].Value;
            if (match.Groups[5].Success) return match.Groups[5].Value;
        }
        return null;
    }

    internal static IReadOnlyList<FeedArticle> ParseXml(FeedSource source, string xml) => ParseDocument(source, XDocument.Parse(xml, LoadOptions.None));
    internal static IReadOnlyList<FeedArticle> ParseJson(FeedSource source, string json) { using var document = JsonDocument.Parse(json); return ParseJsonDocument(source, document.RootElement); }

    private static IReadOnlyList<FeedArticle> ParseJsonDocument(FeedSource source, JsonElement root)
    {
        var version = JsonString(root, "version");
        if (version is null || !version.StartsWith("https://jsonfeed.org/version/", StringComparison.OrdinalIgnoreCase)) throw new FormatException("Unsupported JSON Feed version.");
        var feedTitle = JsonString(root, "title") ?? source.Title ?? HostName(source.Url);
        var favicon = JsonString(root, "favicon") ?? JsonString(root, "icon") ?? FaviconFrom(source.Url);
        if (!root.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) return Array.Empty<FeedArticle>();
        return items.EnumerateArray().Select(item =>
        {
            var itemId = JsonString(item, "id");
            var title = JsonString(item, "title") ?? "(untitled)";
            var articleUrl = JsonString(item, "url") ?? JsonString(item, "external_url") ?? source.Url;
            var summary = JsonString(item, "summary") ?? JsonString(item, "content_text") ?? JsonString(item, "content_html");
            var published = ParseDate(JsonString(item, "date_published") ?? JsonString(item, "date_modified"));
            var thumbnail = JsonString(item, "image") ?? JsonString(item, "banner_image");
            var article = BuildArticle(source, feedTitle, title, articleUrl, summary, published, favicon, thumbnail);
            return string.IsNullOrWhiteSpace(itemId) ? article : article with { Id = StableId(source.Url, itemId) };
        }).ToList();
    }

    private static string? JsonString(JsonElement element, string name) => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static IReadOnlyList<FeedArticle> ParseDocument(FeedSource source, XDocument document)
    {
        var root = document.Root ?? throw new FormatException("Feed XML has no root element.");
        if (root.Name.LocalName.Equals("feed", StringComparison.OrdinalIgnoreCase)) return ParseAtom(source, root);
        if (root.Name.LocalName.Equals("rss", StringComparison.OrdinalIgnoreCase)) return ParseRss(source, root);
        if (root.Name.LocalName.Equals("RDF", StringComparison.OrdinalIgnoreCase)) return ParseRdf(source, root);
        throw new FormatException($"Unsupported XML feed root: {root.Name.LocalName}");
    }

    private static IReadOnlyList<FeedArticle> ParseRss(FeedSource source, XElement root)
    {
        var channel = root.Elements().FirstOrDefault(x => x.Name.LocalName == "channel") ?? root;
        var feedTitle = Text(channel, "title") ?? source.Title ?? HostName(source.Url);
        var favicon = FirstUrl(channel.Descendants().FirstOrDefault(x => x.Name.LocalName == "image"), "url") ?? FaviconFrom(source.Url);
        return channel.Elements().Where(x => x.Name.LocalName == "item").Select(item => BuildArticle(source, feedTitle, Text(item, "title") ?? "(untitled)", FirstUrl(item, "link") ?? Text(item, "guid") ?? source.Url, Text(item, "description") ?? Text(item, "encoded"), ParseDate(Text(item, "pubDate") ?? Text(item, "date")), favicon, FindThumbnail(item, source.Url))).ToList();
    }

    private static IReadOnlyList<FeedArticle> ParseAtom(FeedSource source, XElement root)
    {
        var feedTitle = Text(root, "title") ?? source.Title ?? HostName(source.Url);
        var icon = Text(root, "icon") ?? Text(root, "logo") ?? FaviconFrom(source.Url);
        return root.Elements().Where(x => x.Name.LocalName == "entry").Select(entry =>
        {
            var link = entry.Elements().FirstOrDefault(x => x.Name.LocalName == "link" && ((string?)x.Attribute("rel") is null or "alternate"));
            var href = (string?)link?.Attribute("href");
            var articleUrl = string.IsNullOrWhiteSpace(href) ? source.Url : ResolveUrl(source.Url, href);
            if (string.IsNullOrWhiteSpace(articleUrl)) articleUrl = source.Url;
            return BuildArticle(source, feedTitle, Text(entry, "title") ?? "(untitled)", articleUrl, Text(entry, "summary") ?? Text(entry, "content"), ParseDate(Text(entry, "published") ?? Text(entry, "updated")), ResolveUrl(source.Url, icon), FindThumbnail(entry, source.Url));
        }).ToList();
    }

    private static IReadOnlyList<FeedArticle> ParseRdf(FeedSource source, XElement root)
    {
        var channel = root.Elements().FirstOrDefault(x => x.Name.LocalName == "channel");
        var feedTitle = Text(channel, "title") ?? source.Title ?? HostName(source.Url);
        var favicon = FaviconFrom(source.Url);
        return root.Elements().Where(x => x.Name.LocalName == "item").Select(item => BuildArticle(source, feedTitle, Text(item, "title") ?? "(untitled)", FirstUrl(item, "link") ?? source.Url, Text(item, "description") ?? Text(item, "encoded"), ParseDate(Text(item, "date")), favicon, FindThumbnail(item, source.Url))).ToList();
    }

    private static FeedArticle BuildArticle(FeedSource source, string feedTitle, string title, string url, string? summary, DateTimeOffset? published, string? favicon, string? thumbnail)
    {
        var absoluteUrl = ResolveUrl(source.Url, url);
        return new FeedArticle(StableId(absoluteUrl, title), CleanText(feedTitle, 120), CleanText(title, 240), absoluteUrl, string.IsNullOrWhiteSpace(summary) ? null : CleanText(summary, 600), published, ResolveUrl(source.Url, favicon), ResolveUrl(source.Url, thumbnail));
    }

    private static string? FindThumbnail(XElement item, string baseUrl)
    {
        var media = item.Descendants().FirstOrDefault(x => (x.Name.LocalName == "thumbnail" || x.Name.LocalName == "content") && (string?)x.Attribute("url") is not null);
        if ((string?)media?.Attribute("url") is { Length: > 0 } mediaUrl) return ResolveUrl(baseUrl, mediaUrl);
        var enclosure = item.Elements().FirstOrDefault(x => x.Name.LocalName == "enclosure" && ((string?)x.Attribute("type"))?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true);
        if ((string?)enclosure?.Attribute("url") is { Length: > 0 } enclosureUrl) return ResolveUrl(baseUrl, enclosureUrl);
        var atomImage = item.Elements().FirstOrDefault(x => x.Name.LocalName == "link" && ((string?)x.Attribute("rel")) == "enclosure" && ((string?)x.Attribute("type"))?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true);
        if ((string?)atomImage?.Attribute("href") is { Length: > 0 } atomUrl) return ResolveUrl(baseUrl, atomUrl);
        var html = Text(item, "content") ?? Text(item, "encoded") ?? Text(item, "description") ?? Text(item, "summary");
        if (!string.IsNullOrWhiteSpace(html)) { var match = ImgSrcRegex().Match(html); if (match.Success) return ResolveUrl(baseUrl, WebUtility.HtmlDecode(match.Groups[1].Value)); }
        return null;
    }

    private static string? Text(XElement? parent, string localName) => parent?.Elements().FirstOrDefault(x => x.Name.LocalName.Equals(localName, StringComparison.OrdinalIgnoreCase))?.Value;
    private static string? FirstUrl(XElement? parent, string localName) => Text(parent, localName)?.Trim();
    private static DateTimeOffset? ParseDate(string? value) => DateTimeOffset.TryParse(value, out var date) ? date : null;
    private static string CleanText(string value, int maxLength) { var withoutTags = HtmlTagRegex().Replace(value, " "); var decoded = WebUtility.HtmlDecode(withoutTags); var collapsed = WhitespaceRegex().Replace(decoded, " ").Trim(); return collapsed.Length <= maxLength ? collapsed : collapsed[..(maxLength - 1)] + "…"; }
    private static string ResolveUrl(string baseUrl, string? candidate) { if (string.IsNullOrWhiteSpace(candidate)) return string.Empty; if (Uri.TryCreate(candidate, UriKind.Absolute, out var absolute) && (absolute.Scheme == Uri.UriSchemeHttp || absolute.Scheme == Uri.UriSchemeHttps)) return absolute.ToString(); if (Uri.TryCreate(new Uri(baseUrl), candidate, out var relative) && (relative.Scheme == Uri.UriSchemeHttp || relative.Scheme == Uri.UriSchemeHttps)) return relative.ToString(); return string.Empty; }
    private static string FaviconFrom(string url) => new Uri(new Uri(url), "/favicon.ico").ToString();
    private static string HostName(string url) => new Uri(url).Host;
    private static string StableId(string url, string title) { var hash = SHA256.HashData(Encoding.UTF8.GetBytes(url + "\n" + title)); return Convert.ToHexString(hash.AsSpan(0, 8)).ToLowerInvariant(); }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Feedboard/0.1 (+https://github.com/trvny/trvny)");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/feed+json"); client.DefaultRequestHeaders.Accept.ParseAdd("application/json"); client.DefaultRequestHeaders.Accept.ParseAdd("application/rss+xml"); client.DefaultRequestHeaders.Accept.ParseAdd("application/atom+xml"); client.DefaultRequestHeaders.Accept.ParseAdd("application/xml"); client.DefaultRequestHeaders.Accept.ParseAdd("text/xml");
        return client;
    }

    private sealed record FeedCacheEntry(
        IReadOnlyList<FeedArticle> Articles,
        string? ETag,
        DateTimeOffset? LastModified,
        int FailureCount,
        DateTimeOffset? RetryAfter);
    private sealed record SiteIconCacheEntry(Lazy<Task<string?>> Value, DateTimeOffset ExpiresAt);

    [GeneratedRegex("<link\\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex LinkTagRegex();
    [GeneratedRegex("([A-Za-z_:][-A-Za-z0-9_:.]*)\\s*=\\s*(?:((?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex HtmlAttributeRegex();
    [GeneratedRegex("<img[^>]+src=[\\\"']([^\\\"']+)[\\\"']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex ImgSrcRegex();
    [GeneratedRegex("<[^>]+>")] private static partial Regex HtmlTagRegex();
    [GeneratedRegex("\\s+")] private static partial Regex WhitespaceRegex();
}
