using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Feedboard.Models;

public sealed record FeedSource(
    string Url,
    string? Title = null,
    bool Enabled = true,
    string? Id = null)
{
    [JsonIgnore]
    public string StableId => string.IsNullOrWhiteSpace(Id) ? FeedIdentity.FromUrl(Url) : Id;
}

public static class FeedUrl
{
    public static bool TryNormalize(string? url, out string normalized)
    {
        normalized = string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)) return false;
        var builder = new UriBuilder(uri)
        {
            Scheme = uri.Scheme.ToLowerInvariant(),
            Host = uri.IdnHost.ToLowerInvariant(),
        };
        if ((builder.Scheme == Uri.UriSchemeHttp && builder.Port == 80) ||
            (builder.Scheme == Uri.UriSchemeHttps && builder.Port == 443)) builder.Port = -1;
        normalized = builder.Uri.AbsoluteUri;
        return true;
    }

    public static bool Equivalent(string? left, string? right) =>
        TryNormalize(left, out var a) && TryNormalize(right, out var b) &&
        string.Equals(a, b, StringComparison.Ordinal);
}

public static class FeedIdentity
{
    public static string FromUrl(string url)
    {
        var normalized = FeedUrl.TryNormalize(url, out var value) ? value : url.Trim();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
    }
}

public sealed record FeedArticle(
    string Id,
    string FeedTitle,
    string Title,
    string Url,
    string? Summary,
    DateTimeOffset? Published,
    string? FaviconUrl,
    string? ThumbnailUrl);

public sealed record WidgetState(
    string? ExpandedArticleId = null,
    IReadOnlyList<string>? SelectedFeedUrls = null,
    IReadOnlyList<string>? ReadArticleIds = null,
    IReadOnlyList<string>? SelectedFeedIds = null);