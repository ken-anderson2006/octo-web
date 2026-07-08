/**
 * Runtime de-brand of the Excalidraw surfaces that have NO public i18n / composition seam in
 * @excalidraw/excalidraw 0.18.1:
 *
 *   - the "更多工具 → Mermaid 至 Excalidraw" dropdown item (`toolBar.mermaidToExcalidraw`), and
 *   - the Mermaid dialog title + description (`mermaid.title` / `mermaid.description`) (XIN-531
 *     items 3 & 4), and
 *   - the "浏览素材库 / Browse libraries" online entry in the library panel (XIN-557).
 *
 * Why not i18n override / props: 0.18.1 exposes no way to override individual translations. `t()`
 * reads a module-private `currentLangData`, and there is no `langData` prop or setter on the public
 * API. The mermaid menu item is rendered inside Excalidraw's own shapes toolbar and the mermaid
 * dialog is a built-in modal, so neither is reachable via props/children the way the main menu
 * (item 1, custom `<MainMenu>`) or the help-dialog buttons (item 2, scoped CSS) are.
 *
 * The library browse entry is the same story: `LibraryMenuControlButtons` unconditionally renders
 * `LibraryMenuBrowseButton` — an `<a class="library-menu-browse-button">` whose `href` points at
 * `VITE_APP_LIBRARY_URL` (excalidraw.com's hosted library) and opens `target="_excalidraw_libraries"`.
 * There is no prop to suppress it, so we strip the anchor at runtime with the same observer. The
 * LOCAL library controls are untouched: the "..." dropdown (load/import `.excalidrawlib`,
 * save-to-file/export, reset) and the add-selection-to-library button are siblings/children of that
 * anchor, and the saved-item grid (click/drag-out reuse) lives elsewhere in the panel.
 *
 * Patching the vendored source is explicitly out of scope, so for all of these we act on the
 * rendered DOM in place: a subtree MutationObserver watches for the specific nodes and either
 * rewrites the upstream brand token to the product word "画布" (mermaid text) or removes the node
 * (online browse anchor) as it appears.
 *
 * Every operation is idempotent: the text rewrite only swaps bare "Excalidraw" tokens inside the
 * three mermaid-specific containers (element structure — e.g. the description's flowchart / sequence
 * / class highlight links — is preserved, and a token-free node is left untouched); the anchor
 * removal is a no-op once the anchor is gone. So re-processing the same node, or observing the
 * mutations these make, never compounds.
 */

/** Product word that replaces the upstream "Excalidraw" brand in the localized whiteboard UI. */
export const BOARD_BRAND = '画布'

/**
 * Swap the bare "Excalidraw" brand token in a mermaid-surface string for the product word. Handles
 * both the localized ("Mermaid 至 Excalidraw", "…在 Excalidraw 中…") and English ("Mermaid to
 * Excalidraw") forms. A string with no token is returned unchanged, so callers can treat this as a
 * cheap no-op and re-run it safely.
 */
export function debrandMermaidText(text: string): string {
  return text.includes('Excalidraw') ? text.replace(/Excalidraw/g, BOARD_BRAND) : text
}

// Mermaid-specific selectors. Scoped narrowly on purpose: other "Excalidraw" mentions (export
// dialog "Excalidraw+", the "Excalidraw 素材库" library, the welcome screen) are NOT rewritten and
// must stay branded, so we never touch text outside these containers.
const MENU_ITEM_SELECTOR = '.dropdown-menu-item__text'
const DIALOG_TARGET_SELECTOR = '.dialog-mermaid-title, .ttd-dialog-desc'

// The online "浏览素材库 / Browse libraries" anchor rendered by `LibraryMenuBrowseButton`. This is
// the ONLY online-library entry; the local dropdown, add-to-library button, and saved-item grid do
// not carry this class, so removing it leaves every local capability intact.
const LIBRARY_BROWSE_BUTTON_SELECTOR = '.library-menu-browse-button'

/**
 * Rewrite the brand token in the DIRECT text nodes of `el`, leaving child elements untouched. The
 * mermaid description renders its highlight links as child `<a>` elements around the "flowchart /
 * sequence / class" words, so touching only `el`'s own text nodes keeps those links intact.
 */
function debrandTextNodes(el: Element): void {
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const original = node.nodeValue ?? ''
      const next = debrandMermaidText(original)
      if (next !== original) node.nodeValue = next
    }
  })
}

/** True for a menu label that belongs to the Mermaid item (the only entry carrying the brand). */
function isMermaidMenuLabel(el: Element): boolean {
  return (el.textContent ?? '').includes('Mermaid')
}

/**
 * Remove the online "browse libraries" anchor(s) inside (or equal to) `el` (XIN-557). Only the
 * `library-menu-browse-button` anchor is removed; sibling local controls are left in place. A no-op
 * once the anchor is gone, so re-running or observing the removal never compounds.
 */
function removeOnlineLibraryEntry(el: Element): void {
  el.querySelectorAll(LIBRARY_BROWSE_BUTTON_SELECTOR).forEach((anchor) => anchor.remove())
  if (el.matches(LIBRARY_BROWSE_BUTTON_SELECTOR)) el.remove()
}

/** Apply every de-brand operation to the target surfaces inside (or equal to) `el`. Idempotent. */
function debrandWithin(el: Element): void {
  // Item 3: the "更多工具 → Mermaid 至 Excalidraw" dropdown item. Matched by its "Mermaid" text
  // rather than the data-testid, which Excalidraw shares with the web-embed tool item.
  el.querySelectorAll(MENU_ITEM_SELECTOR).forEach((label) => {
    if (isMermaidMenuLabel(label)) debrandTextNodes(label)
  })
  if (el.matches(MENU_ITEM_SELECTOR) && isMermaidMenuLabel(el)) debrandTextNodes(el)

  // Item 4: mermaid dialog title + description.
  el.querySelectorAll(DIALOG_TARGET_SELECTOR).forEach(debrandTextNodes)
  if (el.matches(DIALOG_TARGET_SELECTOR)) debrandTextNodes(el)

  // XIN-557: strip the online "浏览素材库 / Browse libraries" entry, keeping local library controls.
  removeOnlineLibraryEntry(el)
}

/**
 * Start de-branding the Excalidraw surfaces under `root` and return a disposer. Excalidraw renders
 * the toolbar menu and library panel inside the canvas and its dialogs into `document.body`
 * portals, so a subtree observer on the document body catches all of them whenever they open. Runs
 * once immediately for anything already mounted, then on every subtree insertion.
 */
export function installExcalidrawDebrand(root: Document | HTMLElement = document): () => void {
  const host = root instanceof Document ? root.body : root
  if (!host || typeof MutationObserver === 'undefined') return () => {}

  debrandWithin(host)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) debrandWithin(node as Element)
      })
    }
  })
  observer.observe(host, { childList: true, subtree: true })

  return () => observer.disconnect()
}
