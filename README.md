![DMM Logo](./dmm-logo.svg)

# Debrid Media Manager

Start building your media library with truly unlimited storage size!

## What is this?

Do you want a movie and TV show library that has unlimited size? Consider using a Debrid service, like Real-Debrid, AllDebrid, or TorBox. These services work like a shared storage space for downloading torrents. You can download as much as you want without worrying about storage limits, because the files are shared among all users. You only "own" the file when you download it to your account.

These Debrid services also offer a WebDAV interface that lets you mount your library as a network drive. You can connect it to media players like [Infuse](https://firecore.com/infuse) (Mac, iPhone, Apple TV, iPad) or media server software like Plex, Emby, or Jellyfin. This way, your media library can be accessed and played from anywhere!

[Debrid Media Manager](https://debridmediamanager.com/) is a **free** and open source web app that makes it easy to download movies and TV shows directly to your Debrid library. Build and curate your media collection without ever worrying about storage limits.

## Features

This builds on top of the amazing service brought by [Real-Debrid](https://real-debrid.com/?id=20475782), [AllDebrid](https://alldebrid.com/?uid=1kk5i&lang=en), and [TorBox](https://torbox.app/subscription?referral=74ffa560-7381-4a18-adb1-cef97378c670).

### Library management

See all your torrents in one page, sort them by name, size, status, or date added. It groups torrents by title and helps you delete duplicates. It can show you failed or slow downloads and delete them.

The library's **Add** buttons accept full magnet links, standalone v1 info hashes, and native `.torrent` files for Real-Debrid, AllDebrid, TorBox, Premiumize, Offcloud, and Debrid-Link. Pasted magnets retain their names, duplicate trackers, webseeds, and other parameters. Hexadecimal and base32 exact topics are recognized, including percent-encoded query parameters, and normalized to literal hexadecimal `urn:btih:` topics at provider boundaries for compatibility. Files are uploaded as-is rather than reduced to a hash, and mixed submissions run their file and magnet batches sequentially.

On Debrid-Link, standalone hash lists remain **cached-only**; full magnets and `.torrent` files explicitly request a download and may consume the account's quota. TorBox also accepts direct HTTP(S) download links in its Add dialog.

Native uploads routed through anticors require its byte-preserving request streaming (`c4159f5` or later). Deploy and probe that Worker before deploying DMM; decoding multipart bodies as text corrupts binary torrent pieces. Premiumize uploads instead stream through DMM's same-origin `/api/premiumize/upload` endpoint.

### Torrent search

Add content to your library by searching for torrents. It detects what you already have downloaded and currently downloading in your library.

### Movie and TV show info pages

Browse detailed information about movies and TV shows including cast, crew, trailers, and related content. View comprehensive person filmography pages to explore an actor's or director's complete work.

### Stremio integration

Use DMM as a Stremio addon to stream your debrid library directly through Stremio. Includes a Cast addon for sharing your library streams.

### Trakt integration

Sync with your Trakt watchlist, collection, and custom lists to easily add content to your library.

### Share your library and mirror other libraries

Share your whole collection or select specific items. Head over to [r/debridmediamanager](https://www.reddit.com/r/debridmediamanager/) to see other people's media collections and easily mirror their content to yours.

## Setup

1. Have a MySQL database ready
2. Clone this repository
3. Create your local env file: `cp .env.example .env.local` and fill in the details
4. Fill in required settings in `.env.local`:
    - `DATABASE_URL` - Your MySQL connection string
5. (Optional) Configure additional integrations in `.env.local`:
    - `TMDB_KEY`, `OMDB_KEY`, `MDBLIST_KEY` - For enhanced movie/show metadata
    - `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET` - For Trakt integration
    - `PROXY` - SOCKS5 proxy for stream proxying (e.g. `localhost:9050`)
    - See `.env.example` for all available options
6. Install the dependencies: `npm install`
7. Run the app: `npm run dev` (development) or `npm run build && npm run start` (production)
8. Head to `http://localhost:3000`

### Docker

```bash
cp .env.example .env.local
# Fill in your settings in .env.local
docker swarm init
docker stack deploy -c docker-compose.yml dmm
```

The website will be accessible at `http://localhost:3000`

## Terminal client (`dmm-tui`)

A terminal client for the search-and-add flow: find a title, pick a release, see
whether Torbox holds it, and add it — with no browser and no window manager. It
talks to a DMM instance over its own HTTP API and to Torbox directly; your key
never reaches DMM.

```bash
npm run tui
```

Requires Node 22 or newer.

### Configuration

Either `~/.config/dmm-tui/config.json`:

```json
{
	"dmmBaseUrl": "http://localhost:3000",
	"torboxApiKey": "your-torbox-api-key"
}
```

or the environment — `DMM_BASE_URL` and `TORBOX_API_KEY`. Command-line flags win
over both. Validate without starting the UI:

```bash
npm run tui -- --check-config
```

Check what a title resolves to, without any credentials at all:

```bash
npm run tui -- --dump "Blade Runner"
```

`--dump` prints each stage of the read pipeline as it goes, so a DMM that is not
answering says so at the stage that is not answering, rather than as an empty
grid.

### Keys

| Key      | Does                                             |
| -------- | ------------------------------------------------ |
| `↑` `↓`  | move                                             |
| `enter`  | show the files Torbox lists for this release     |
| `a`      | add to Torbox                                    |
| `y`      | send the selected hash to the terminal clipboard |
| `/`      | filter                                           |
| `[` `]`  | previous / next page of releases                 |
| `r`      | re-fetch this page and re-probe Torbox           |
| `u`      | show or hide uncached releases                   |
| `z`      | show or hide archive-only releases               |
| `<` `>`  | previous / next season                           |
| `esc`    | back                                             |
| `ctrl-c` | quit                                             |

### Filtering

`/` takes the same grammar as the browser's quick search: bare words are regular
expressions matched against the release name, `-word` excludes, and terms combine
with AND.

| Term                                  | Means                                 |
| ------------------------------------- | ------------------------------------- |
| `is:tb`, `is:cached`                  | Torbox holds it                       |
| `is:uncached`                         | Torbox does not                       |
| `is:archive`                          | held as one archive, nothing playable |
| `is:added`                            | added by this session                 |
| `videos:10`, `videos:>5`, `videos:<3` | by video count                        |
| `blade` , `-dune`                     | include / exclude by name             |

`videos:` counts what Torbox listed. An uncached release has no listing yet, so it
counts as zero however many episodes its name claims — `videos:>5` finds cached
rows only. That is the measured number rather than one guessed from the name.

### What it will not do

- **Cached rows add on the key press, with no confirmation.** A confirmation on
  every free action trains you to press through dialogs, which is the opposite of
  what the dialog on an uncached add is for. Uncached adds always confirm first.
- **`y` cannot confirm the copy happened.** It writes an OSC 52 escape sequence,
  which tmux and many terminals refuse silently. The hash is also printed, so it
  is recoverable either way.
- **It does not create releases.** It reads what DMM already has. An instance
  with no scraper behind it will keep answering "not scraped yet" forever.

## FAQ

### I just don't know where to start or why do I need this?

[Read the guide here](https://docs.google.com/document/d/13enrfVXcGEEd0Yqb0PBTpGYrIvQpSfeIaAMZ_LiBDzM/edit).

### But with Kodi and FEN and Stremio being available, why would I ever need this?

If you want some level of curation on your library. I personally prefer watching only 100+ GB remux releases. Don't ask me about -arr apps and/or Usenet. I also came from that setup and found it too time consuming to maintain.

### How does it monitor what's in your library?

It doesn't do any sort of monitoring. It gets that information when you open the Library page and caches it in your browser's local storage.

### When I share my library, is it linked to my account's identity?

No. It's completely anonymous. What's shared are 3 things: filename, magnet hash, file size. It's not even stored in any database. The data is compressed and stored in the URL. A "webpage" is then created over at https://hashlists.debridmediamanager.com that loads this list of magnet hashes.

## License

This project is licensed under the [AGPL-3.0](LICENSE).
