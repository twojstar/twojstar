using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;

namespace Feedboard.Services;

public sealed partial class FeedDiscovery
{
    private const int MaxProbeBytes = 128 * 1024;
    private const int MaxHtmlBytes = 512 * 1024;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);
    private static readonly HttpClient Http = CreateHttpClient();
    private static readonly char[] AsciiWhitespace = [' ', '\t', '\n', '\r', '\f'];
    private static readonly HashSet<string> AdvertisedFeedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/rss+xml",
        "application/atom+xml",
        "application/feed+json",
        "application/json",
        "application/rdf+xml"
    };
    private static readonly HashSet<string> StrongFeedMediaTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/rss+xml",
        "application/atom+xml",
        "application/feed+json",
        "application/rdf+xml"
    };

    public async Task<string> ResolveFeedUrlAsync(string input, CancellationToken cancellationToken = default)
    {
        if (!TryHttpUri(input, out var inputUri))
            throw new ArgumentException("Enter a valid website or feed URL.", nameof(input));

        var initial = await FetchAsync(inputUri, MaxHtmlBytes, cancellationToken);
        if (LooksLikeFeed(initial.MediaType, initial.Body)) return initial.FinalUri.ToString();

        if (!LooksLikeHtml(initial.MediaType, initial.Body))
            throw new InvalidOperationException("That URL did not return a supported RSS, Atom, RDF or JSON Feed.");

        var html = Encoding.UTF8.GetString(initial.Body);
        foreach (var candidate in DiscoverCandidates(initial.FinalUri, html))
        {
            try
            {
                var probe = await FetchAsync(candidate, MaxProbeBytes, cancellationToken);
                if (LooksLikeFeed(probe.MediaType, probe.Body)) return probe.FinalUri.ToString();
            }
            catch (HttpRequestException)
            {
                // A page can advertise stale feed links. Keep trying the remaining candidates.
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                // A slow advertised candidate should not prevent trying the remaining candidates.
            }
        }

        throw new InvalidOperationException("No working RSS, Atom, RDF or JSON Feed was advertised by that page.");
    }

    private static IEnumerable<Uri> DiscoverCandidates(Uri pageUri, string html)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match tag in LinkTagRegex().Matches(html))
        {
            var rel = AttributeValue(tag.Value, "rel");
            if (rel is null || !rel.Split(AsciiWhitespace, StringSplitOptions.RemoveEmptyEntries)
                    .Any(token => token.Equals("alternate", StringComparison.OrdinalIgnoreCase))) continue;

            var type = AttributeValue(tag.Value, "type");
            if (type is null || !AdvertisedFeedTypes.Contains(type.Split(';', 2)[0].Trim())) continue;

            var href = WebUtility.HtmlDecode(AttributeValue(tag.Value, "href"));
            if (string.IsNullOrWhiteSpace(href) || !Uri.TryCreate(pageUri, href, out var candidate) ||
                (candidate.Scheme != Uri.UriSchemeHttp && candidate.Scheme != Uri.UriSchemeHttps)) continue;

            if (seen.Add(candidate.ToString())) yield return candidate;
        }
    }

    private static async Task<ProbeResponse> FetchAsync(Uri uri, int maxBytes, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(RequestTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(timeoutCts.Token);
        var body = await ReadPrefixAsync(stream, maxBytes, timeoutCts.Token);
        var finalUri = response.RequestMessage?.RequestUri ?? uri;
        return new ProbeResponse(finalUri, response.Content.Headers.ContentType?.MediaType, body);
    }

    private static async Task<byte[]> ReadPrefixAsync(Stream stream, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream(Math.Min(maxBytes, 16 * 1024));
        var chunk = new byte[8 * 1024];
        while (buffer.Length < maxBytes)
        {
            var remaining = maxBytes - (int)buffer.Length;
            var read = await stream.ReadAsync(chunk.AsMemory(0, Math.Min(chunk.Length, remaining)), cancellationToken);
            if (read == 0) break;
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }

        return buffer.ToArray();
    }

    private static bool LooksLikeFeed(string? mediaType, byte[] body)
    {
        if (mediaType is not null && StrongFeedMediaTypes.Contains(mediaType)) return true;
        var prefix = DecodePrefix(body);
        return XmlFeedRootRegex().IsMatch(prefix) || JsonFeedVersionRegex().IsMatch(prefix);
    }

    private static bool LooksLikeHtml(string? mediaType, byte[] body)
    {
        if (string.Equals(mediaType, "text/html", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(mediaType, "application/xhtml+xml", StringComparison.OrdinalIgnoreCase)) return true;
        return HtmlRootRegex().IsMatch(DecodePrefix(body));
    }

    private static string DecodePrefix(byte[] body)
    {
        if (body.Length == 0) return string.Empty;
        using var stream = new MemoryStream(body, writable: false);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
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

    private static bool TryHttpUri(string? value, out Uri uri)
    {
        var candidate = value?.Trim();
        if (!string.IsNullOrWhiteSpace(candidate) && !candidate.Contains("://", StringComparison.Ordinal))
            candidate = "https://" + candidate;

        if (Uri.TryCreate(candidate, UriKind.Absolute, out var parsed) &&
            (parsed.Scheme == Uri.UriSchemeHttp || parsed.Scheme == Uri.UriSchemeHttps))
        {
            uri = parsed;
            return true;
        }

        uri = null!;
        return false;
    }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Feedboard/0.1 (+https://github.com/trvny/trvny)");
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/rss+xml"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/atom+xml"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/feed+json"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    private sealed record ProbeResponse(Uri FinalUri, string? MediaType, byte[] Body);

    [GeneratedRegex("<link\\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LinkTagRegex();

    [GeneratedRegex("([A-Za-z_:][-A-Za-z0-9_:.]*)\\s*=\\s*(?:((?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HtmlAttributeRegex();

    [GeneratedRegex("^\\s*(?:<\\?xml[^>]*>\\s*)?(?:<!--.*?-->\\s*)*<(?:rss\\b|feed\\b|(?:[A-Za-z_][\\w.-]*:)?RDF\\b)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex XmlFeedRootRegex();

    [GeneratedRegex("^\\s*\\{[\\s\\S]{0,8192}?\"version\"\\s*:\\s*\"https://jsonfeed\\.org/version/", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex JsonFeedVersionRegex();

    [GeneratedRegex("^\\s*(?:<!doctype\\s+html\\b|<html\\b)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HtmlRootRegex();
}
