import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Sanitized markdown → HTML. DOMPurify matters here: web_search results flow
// into model output, so rendered replies aren't fully trusted content.
export default function Md({ text }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(text || '')) }} />
}
