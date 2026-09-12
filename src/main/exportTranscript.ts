import {
  AlignmentType,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import { displayTranscriptText } from '../shared/transcriptText'
import type { TranscriptDocument } from '../shared/types'

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function safeName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim() || 'TAIMIO'
}

export function transcriptExportFileName(projectName: string, videoName?: string): string {
  const project = safeName(projectName)
  if (!videoName) return `${project} — расшифровка.docx`
  return `${project} — ${safeName(videoName)} — расшифровка.docx`
}

function bodyParagraphs(text: string): Paragraph[] {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (chunks.length === 0) {
    return [
      new Paragraph({
        children: [new TextRun({ text: 'Текст расшифровки пуст.', italics: true, font: 'Calibri' })]
      })
    ]
  }
  return chunks.map(
    (line) =>
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: line, font: 'Calibri', size: 22 })]
      })
  )
}

export async function buildTranscriptDocx(options: {
  projectName: string
  videos: Array<{ name: string; durationSec: number | null; transcript: TranscriptDocument }>
}): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: options.projectName, font: 'Calibri', bold: true })]
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: options.videos.length > 1 ? 'Сводная расшифровка' : 'Расшифровка',
          italics: true,
          color: '5B5B7A',
          font: 'Calibri',
          size: 24
        })
      ]
    })
  ]

  for (const video of options.videos) {
    const duration =
      video.durationSec != null && video.durationSec > 0 ? ` · ${clock(video.durationSec)}` : ''
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        children: [new TextRun({ text: `${video.name}${duration}`, font: 'Calibri' })]
      })
    )
    children.push(...bodyParagraphs(displayTranscriptText(video.transcript)))
  }

  children.push(
    new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: 'TAIMIO · Не пересматривай. Найди.',
          italics: true,
          color: '8888A0',
          size: 18
        })
      ]
    })
  )

  const document = new Document({
    creator: 'TAIMIO',
    title: `${options.projectName} — расшифровка`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.9),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1)
            }
          }
        },
        children
      }
    ]
  })

  return Buffer.from(await Packer.toBuffer(document))
}
