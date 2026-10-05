# Chrome Web Store Release Checklist

## Package
- [x] Manifest V3
- [x] Production package contains only runtime files and required icons
- [x] No README, screenshots, Git metadata, scripts, or development files inside the extension ZIP
- [x] No remote code detected in reviewed source
- [x] Permissions reduced for Store release
- [x] Version set to 1.9.5

## Store assets
- [x] 128x128 store icon available (`icon128.png`)
- [x] Dashboard screenshot prepared at 1280x800
- [x] Settings screenshot prepared at 1280x800
- [ ] Optional: create a 440x280 small promo tile
- [ ] Optional: create a 1400x560 marquee promo tile
- [ ] Optional: add a YouTube demo video

## Store dashboard
- [ ] Register / sign in to Chrome Web Store Developer Dashboard
- [ ] Enable 2-Step Verification on the publishing Google account
- [ ] Create a new item and upload `releases/prompt-and-leave-v1.9.5.zip`
- [ ] Paste listing copy from `store/store-listing.md`
- [ ] Upload the two 1280x800 screenshots
- [ ] Set category to Productivity
- [ ] Add the public URL of `PRIVACY.md`
- [ ] Complete Privacy practices using `store/privacy-practices.md`
- [ ] Confirm distribution/visibility settings
- [ ] Submit for review

## Before every future Store update
- [ ] Increment `manifest.json` version
- [ ] Re-run the permission and remote-code audit
- [ ] Update privacy disclosures if data handling changed
- [ ] Build a fresh production ZIP from runtime files only
