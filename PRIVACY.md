# Privacy

tab-home runs entirely inside the Chrome extension environment. It has no analytics, account system, telemetry endpoint, advertising SDK, or remote database.

The extension reads open tabs and tab groups to render the dashboard and perform actions explicitly requested by the user. Bookmark access is optional and requested only when the user enables the Bookmarks source. Custom favorites, categories, theme, language, cached icons, source visibility, and folder-collapse preferences are stored in `chrome.storage.local`.

For automatic custom-favorite icons, the extension may request the favorite website itself and Chrome's local favicon endpoint. It does not send visited or saved URLs to third-party icon services. User-uploaded custom icons remain in local extension storage.

Cross-source drag operations can create or delete Chrome bookmarks, create or close tabs, and add or remove custom favorites. The destination is created first, destructive source removal requires confirmation, and a failed destination leaves the source unchanged.

Uninstalling the extension removes its local extension storage according to Chrome's behavior. Chrome-owned bookmarks are not removed unless the user explicitly deletes or moves them through tab-home.
