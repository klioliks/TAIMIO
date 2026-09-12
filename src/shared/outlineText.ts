import type { AnalysisBlock, AnalysisDocument } from './types'

export function assembleBlockText(block: AnalysisBlock): string {
  const title = block.title.replace(/\s+/g, ' ').trim()
  const theses = block.theses.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!title) return theses.join(' ')
  if (theses.length === 0) return title
  return `${title}. ${theses.join(' ')}`
}

export function assembleOutlineBody(doc: AnalysisDocument | null | undefined): string {
  if (!doc?.blocks.length) return ''
  return doc.blocks.map(assembleBlockText).filter(Boolean).join('\n\n')
}

export function outlineTimeAtOffset(doc: AnalysisDocument, offset: number): number {
  if (doc.blocks.length === 0) return 0
  let cursor = 0
  for (let index = 0; index < doc.blocks.length; index += 1) {
    const piece = assembleBlockText(doc.blocks[index])
    if (!piece) continue
    const end = cursor + piece.length
    if (offset <= end || index === doc.blocks.length - 1) {
      return doc.blocks[index].start
    }
    cursor = end + 2
  }
  return doc.blocks[doc.blocks.length - 1].start
}
