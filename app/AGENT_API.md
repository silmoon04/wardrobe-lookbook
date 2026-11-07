# Wardrobe controls

Wait for `document.documentElement.dataset.ready === 'true'`. Product cutouts and the gallery's mask images are decoded when `dataset.productsReady === 'true'`. Use accessible names or `data-action` attributes to drive the visible interface.

| Action | Control |
| --- | --- |
| Choose category | `[data-action="category"][data-slot="base|mid|outer|bottom|shoes"]` |
| Wear / remove worn item | `[data-action="wear"][data-item="ID"]` |
| Search every category | `[data-action="search"]`, then `[data-action="search-input"]` |
| Step active category | `[data-action="previous-item"]`, `[data-action="next-item"]` |
| Random outfit | `[data-action="randomise"]` at the lower left of the phone stage or in the web toolbar |
| View | `[data-action="view"][data-view="front|back"]` |
| History | `[data-action="undo"]`, `[data-action="redo"]` |
| Layer options | `[data-action="tuck"]`, `[data-action="closure"]`, `[data-action="finish"]` |
| Remove layer | `[data-action="remove-layer"][data-remove="SLOT"]` |
| Settings | `[data-action="settings"]` beside the phone category dock or in the web stage |
| Hair / Face / Theme | `[data-action="choose-hair"]`, `[data-action="choose-face"]`, `[data-action="set-theme"]` |
| Compare | Phone: open `[data-action="menu"]`, then `[data-action="compare"]`; web: direct Compare. Change an item or shuffle. |
| Save / reopen | `[data-action="save"]` saves immediately; Looks beside Save (`#open-looks`), then `[data-action="open-look"]` |

Phone category sheets stay open after choosing. The dock remains reachable. Tap the selected item to remove it. Swipe horizontally on the mannequin to change the active category's item. Desktop arrows do the same. `F`/`B` change view, `/` focuses global search, `Z`/`Shift+Z` undo/redo. Text inputs keep their native keyboard behavior.

The phone view button names the next view. Phone history controls live in the hanger menu. When Compare is active, its selected button occupies the Looks position in the toolbar; Looks remains in the hanger menu.

On phone, the category header holds the worn item's options. On desktop they remain in its layer row. These are the same controls moved between surfaces. Saved looks appear first and close the gallery when opened. Compare pins the current look on first use. The local-tools menu retains named Save as.

`window.wardrobeTest` is also available for integrations:

```js
wardrobeTest.state()              // cloned look, view, saved looks, browse state and settings
wardrobeTest.manifest()           // catalogue IDs, variants and labels
wardrobeTest.wear('p-037')         // idempotently wear a known item
wardrobeTest.remove('outer')      // remove one slot; shoes also removes default footwear
wardrobeTest.set('tucked', true)   // base top
wardrobeTest.set('outerOpen', false)
wardrobeTest.set('finish', 'smooth')
wardrobeTest.set('head', 'G2')     // IDs come from manifest().mannequin.headOptions
wardrobeTest.set('theme', 'dark')  // theme and shadows are global settings
wardrobeTest.view('back')
wardrobeTest.shuffle(2000)        // reproducible outfit
wardrobeTest.search('white tee')  // global search; returns matching IDs
```

`getState()`, `setView()`, `layers()`, `profile()` and `settings()` retain their existing contracts. `state()` and `getState()` return copies. Item changes enter undo history. The compositor and registered layer assets remain shared by the studio, gallery and Lookbook.
