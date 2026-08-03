# Privacy

tab-home runs entirely inside the Chrome extension environment. It has no analytics, account system, telemetry endpoint, advertising SDK, or remote database.

The extension reads open tabs and tab groups to render the dashboard and perform actions explicitly requested by the user. Bookmark access is optional and requested only when the user enables the Bookmarks source. Custom favorites, categories, theme, language, cached icons, source visibility, and folder-collapse preferences are stored in `chrome.storage.local`.

For automatic icons across custom favorites, Chrome bookmarks, and live tab groups, the extension may request the website itself, icon assets explicitly declared by that website, and Chrome's local favicon endpoint. It does not send visited or saved URLs to third-party icon lookup services. User-uploaded item or website icons remain in local extension storage.

Cross-source drag operations can create or delete Chrome bookmarks, create or close tabs, and add or remove custom favorites. The destination is created first, destructive source removal requires confirmation, and a failed destination leaves the source unchanged.

Uninstalling the extension removes its local extension storage according to Chrome's behavior. Chrome-owned bookmarks are not removed unless the user explicitly deletes or moves them through tab-home.
