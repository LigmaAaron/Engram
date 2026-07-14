/* Module registry — React-free on purpose so node tests can import it.
   A module is a folder in src/modules/<id>/ whose index.jsx calls registerWidget
   with a manifest: { id, title, icon, order, span, Widget?, Page?, nav? }. */
let widgets = []
const subs = new Set()

export const getWidgets = () => widgets
export const onWidgets = (f) => { subs.add(f); return () => subs.delete(f) }
export const registerWidget = (w) => {
  if (widgets.find((x) => x.id === w.id)) return
  widgets = [...widgets, w].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  subs.forEach((f) => f())
}
