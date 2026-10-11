# Social publishing product roadmap

Reference: [Ocoya's public product overview](https://www.ocoya.com/), reviewed October 11, 2026. This is a capability comparison, not a copy of its interface or branding. Public marketing does not establish how every integration works internally.

Priority chosen: publishing, scheduling, and account connections.

## Existing foundation

The repository already contains organization and role management, a post composer with account-specific captions and media, draft/review flows, a publishing queue, LinkedIn and Meta adapters, AI-assisted creation, brands, campaigns, media storage, analytics, and WhatsApp messaging. Having an adapter does not establish that a production account is connected or authorized.

## Publishing upgrade implemented in this change

- Connection cards for the implemented providers, with server configuration status, connection counts, reconnect warnings, and copyable callback URLs derived from APP_URL. The account menu includes an on-demand remote connection check; successful profile access does not prove publishing permissions are granted.
- Calendar month and agenda views with channel/status filters, publication times, month counters, neighboring days, and links that prefill a new post's date.
- Dragging queued/scheduled posts opens a rescheduling confirmation. The clock button provides the same action for keyboard and touch users.
- Rescheduling preserves approvals, checks ownership and workspace boundaries, replaces queued job revisions, and rejects posts whose publication has started or which have already published to an account.
- CSV plan import, up to 100 posts, with a downloadable template, account selection, quoted/multiline caption support, timezone-aware date parsing, preview, and atomic creation of drafts. Imports do not publish or schedule anything automatically. Imports retain the normal media validation and approval requirements.

No database migration or additional paid service is needed for this upgrade.

## Remaining work toward broad feature parity

| Area                       | Remaining capability                                                                                                    | Dependency / acceptance condition                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Production Meta connection | Connect Pages and linked professional Instagram accounts                                                                | Production App ID/secret, exact HTTPS redirect URL, granted publishing permissions, and a successful user-authorized publish |
| Additional social networks | X, TikTok, YouTube, Threads, Pinterest, Bluesky and business listings                                                   | Individual adapters, OAuth applications and approved scopes; integration tests against the actual provider                   |
| Community and CMS channels | Telegram, Slack, Discord, Mastodon, Dribbble, Kick, Twitch, Whop, DEV, WordPress, Tumblr, WooCommerce, custom endpoints | Provider-specific authentication, account discovery, validation, retry and removal semantics                                 |
| Post formats               | Complete composer support for video, Reels, Stories, threads and document carousels                                     | Provider capability controls, media processing, previews and actual API verification; never advertise unsupported formats    |
| Scheduling                 | Weekly/time-slot queues, bulk scheduling, recurring campaigns, evergreen reuse                                          | Explicit timezone/DST rules, approval behavior, recurrence limits, duplicate protection and cancellation tests               |
| Suggested times            | Recommendations informed by account engagement history                                                                  | Sufficient metrics and a disclosed fallback when history is unavailable                                                      |
| Social inbox               | Unified social DMs, comments and mentions beyond existing WhatsApp inbox                                                | Per-network webhooks and messaging permissions, conversation ownership, reply auditing                                       |
| Creative studio            | Brand-aware asset editing, reusable templates, carousel and short-video generation                                      | Asset editor/export pipeline and configured image/video generation providers                                                 |
| Automation                 | Visual trigger/action workflows for content and replies                                                                 | Bounded execution, approval rules, audit trail and provider rate limits                                                      |
| Bio pages                  | Branded profile landing pages                                                                                           | Public rendering, safe links, workspace ownership and analytics                                                              |
| Developer access           | Public API keys, API documentation and an MCP server for this application                                               | Scoped API authentication, revocation, rate limits and audited tool permissions                                              |
| Team reporting             | Finish shared workspaces, approval UX, exports and consolidated reports                                                 | Role-based end-to-end verification and real production metrics                                                               |

## Production rollout

Set APP_URL to https://social-media.ishswami.in. Configure provider credentials in the deployment environment, not Git. Register https://social-media.ishswami.in/api/oauth/meta/callback in the selected Meta app's login settings. Run both the web service and publishing worker (or the configured drain mechanism). Verify login, import a small draft batch, schedule a future post, reschedule it, and confirm that only the final revision publishes.

Do not change a live Meta app to development mode solely to support localhost when it also serves production messaging integrations. Use a separate development app or an HTTPS test deployment.
