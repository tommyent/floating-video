# Floating Video

A small, dependency-free Chrome extension for video Picture-in-Picture.

## Controls

The toolbar action and **Alt+P** are designed to toggle Picture-in-Picture for the current tab. The implementation chooses one video across accessible frames, preferring playing video, then the largest displayed area. A ready, paused video is a fallback. Open shadow roots are included; closed shadow roots are not accessible.

The settings page offers optional automatic mode, off by default. Chrome controls eligibility and permission prompts. See [Chrome's automatic PiP requirements](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback): Chrome 134+, playing audible media in the top frame, audio focus, and the site's permission/engagement requirements. Automatic mode is not guaranteed on every site. Chrome manages closing automatically opened windows when returning to the tab.

Automatic mode can replace a site's media-session PiP handler. After disabling it, reload the site to restore its own handler. It does not register a handler while disabled on a fresh page.

The manual action temporarily clears a video's PiP opt-out attribute and restores it when the PiP window closes or the request fails (Chrome closes PiP as soon as the attribute returns). It cannot bypass Chrome's restricted pages, Permissions Policy, or other browser restrictions. Errors appear as a **!** toolbar badge with an explanation in the tooltip.

## Permissions and privacy

- `scripting` and `activeTab`: execute the toolbar action in the selected tab.
- All-site host access: retained for embedded cross-origin videos and automatic mode. Automatic-mode scripts run only in the top frame; manual selection inspects accessible frames on demand.
- `storage`: sync one boolean setting through Chrome Sync. No video content, browsing history, or analytics is collected or sent by extension code.

This is a new extension identity; settings from the downloaded extension are not migrated. The source contains no remote scripts, dependencies, or store update identity. Icons are original geometric assets.

## Development

No install or build step is required. The repository root is the unpacked extension; `floating-video.zip` contains only runtime files and assets.

```sh
node --test
```

Tests use Node's built-in runner and simulated Chrome/DOM APIs. They cover video selection, frame targeting, PiP rejection, repeat clicks, automatic-mode settings races, unsupported APIs, settings persistence errors, and packaged asset references.

The toolbar handler starts script injection immediately and uses Chrome API callbacks through frame selection and the PiP request, keeping asynchronous badge updates out of that path. Regression tests check this call ordering and API-error feedback.

**Live check (Chrome 155, Paramount+, 2026-10-13):** Alt+P opened PiP on a video that carries `disablepictureinpicture`, and the window stayed open; the attribute came back after PiP closed. Before this fix, PiP closed within 3 ms of opening. Other sites, automatic mode, and the settings accessibility tree remain unverified. The test suite establishes simulated logic results, not those browser outcomes.

## Create the private GitHub repository

Run from this directory after committing the prepared files:

```sh
gh repo create floating-video --private --source=. --remote=origin --push
```

This creates a private repository in the authenticated GitHub account and pushes the local commit. No remote repository has been created by this task.
