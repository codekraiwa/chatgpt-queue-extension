# ChatGPT Queue Extension — Git workflow

## Install once

1. Clone this repository.
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this repository folder

Chrome will keep pointing to this folder.

## Update workflow

After editing:

```bash
git add .
git commit -m "Update extension"
git push
```

On another machine:

```bash
git pull
```

Then go to `chrome://extensions` and click **Reload** on ChatGPT Queue.

You do not need to remove/reinstall the extension as long as Chrome still points to the same folder.

## Create a GitHub release ZIP

```bash
./scripts/release.sh 1.5.2
```

This bumps `manifest.json`, commits, tags, pushes, and GitHub Actions creates a release ZIP.

## Important

For a manually loaded unpacked extension, Git can update the files but Chrome still requires **Reload** to reload the extension code.

If you want truly automatic updates without pressing Reload, the normal route is publishing via the Chrome Web Store or another supported packaged-extension update channel.
