using Feedboard.Models;

namespace Feedboard.Services;

public sealed record FeedErrorStatus(string FeedUrl, DateTimeOffset? RetryAfter);

public sealed partial class FeedClient
{
    public IReadOnlyList<FeedErrorStatus> GetErrorStatuses(IEnumerable<FeedSource> sources)
    {
        var statuses = new List<FeedErrorStatus>();
        foreach (var source in sources.Where(source => source.Enabled))
        {
            if (FeedCache.TryGetValue(source.Url, out var cached) && cached.FailureCount > 0)
            {
                statuses.Add(new FeedErrorStatus(source.Url, cached.RetryAfter));
            }
        }

        return statuses;
    }
}
