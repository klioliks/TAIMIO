import {
  AlignmentType,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import { rematchOutlineBlocks } from '../shared/outlineAlign'
import type { AnalysisDocument, RetellDocument, TranscriptDocument } from '../shared/types'

export type OutlineExportKind = 'plan' | 'conspect'

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

export function outlineExportFileName(
  projectName: string,
  videoName?: string,
  kind: OutlineExportKind = 'plan'
): string {
  const project = safeName(projectName)
  const label = kind === 'conspect' ? 'конспект' : 'план с таймингом'
  if (!videoName) return `${project} — ${label}.docx`
  return `${project} — ${safeName(videoName)} — ${label}.docx`
}

type ExportVideo = {
  name: string
  durationSec: number | null
  analysis: AnalysisDocument
  transcript?: TranscriptDocument | null
  retell?: RetellDocument | null
}

function alignedBlocks(video: ExportVideo): AnalysisDocument['blocks'] {
  if (!video.transcript?.segments.length) return video.analysis.blocks
  return rematchOutlineBlocks(video.analysis.blocks, video.transcript.segments)
}

function footer(): Paragraph {
  return new Paragraph({
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
}

function documentOf(title: string, children: Paragraph[]): Document {
  return new Document({
    creator: 'TAIMIO',
    title,
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
}

export async function buildOutlineDocx(options: {
  projectName: string
  videos: ExportVideo[]
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
          text: options.videos.length > 1 ? 'Сводный план с таймингом' : 'План с таймингом',
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

    alignedBlocks(video).forEach((block, index) => {
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

  children.push(footer())
  return Buffer.from(await Packer.toBuffer(documentOf(`${options.projectName} — план с таймингом`, children)))
}

export async function buildConspectDocx(options: {
  projectName: string
  videos: ExportVideo[]
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
          text: options.videos.length > 1 ? 'Сводный конспект' : 'Конспект',
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

    const retell = video.retell?.text?.trim()
    if (retell) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 160, after: 80 },
          children: [new TextRun({ text: 'Краткий пересказ', font: 'Calibri' })]
        })
      )
      for (const paragraph of retell.split(/\n+/).map((line) => line.trim()).filter(Boolean)) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: paragraph, font: 'Calibri', size: 22 })]
          })
        )
      }
    }

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: 'Конспект', font: 'Calibri' })]
      })
    )

    const blocks = alignedBlocks(video)
    if (blocks.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: 'Конспект для этого видео ещё не собран.', italics: true })]
        })
      )
      continue
    }

    for (const block of blocks) {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 60 },
          children: [new TextRun({ text: block.title, font: 'Calibri', bold: true, size: 24 })]
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
    }
  }

  children.push(footer())
  return Buffer.from(await Packer.toBuffer(documentOf(`${options.projectName} — конспект`, children)))
}
