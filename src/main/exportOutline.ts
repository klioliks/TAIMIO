import {
  AlignmentType,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import type { AnalysisDocument } from '../shared/types'

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

export function outlineExportFileName(projectName: string, videoName?: string): string {
  const project = safeName(projectName)
  if (!videoName) return `${project} — план.docx`
  return `${project} — ${safeName(videoName)} — план.docx`
}

export async function buildOutlineDocx(options: {
  projectName: string
  videos: Array<{ name: string; durationSec: number | null; analysis: AnalysisDocument }>
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
          text: options.videos.length > 1 ? 'Сводный план видео' : 'План видео',
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

    if (video.analysis.blocks.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'Конспект для этого видео ещё не собран.', italics: true })]
        })
      )
      continue
    }

    video.analysis.blocks.forEach((block, index) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          children: [
            new TextRun({
              text: `${index + 1}. ${block.title}  (${clock(block.start)}–${clock(block.end)})`,
              font: 'Calibri'
            })
          ]
        })
      )
      for (const thesis of block.theses) {
        const line = thesis.replace(/\s+/g, ' ').trim()
        if (!line) continue
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: [new TextRun({ text: line, font: 'Calibri', size: 22 })]
          })
        )
      }
    })
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
    title: `${options.projectName} — план`,
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
