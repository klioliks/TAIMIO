import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  AlignmentType,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import { rematchOutlineBlocks } from '../shared/outlineAlign'
import { displayTranscriptText } from '../shared/transcriptText'
import type {
  AnalysisDocument,
  RetellDocument,
  TranscriptDocument,
  VisualDocument
} from '../shared/types'
import { visualsDir } from './visuals'

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

export function reportExportFileName(projectName: string, videoName?: string): string {
  const project = safeName(projectName)
  if (!videoName) return `${project} — полный отчёт.docx`
  return `${project} — ${safeName(videoName)} — полный отчёт.docx`
}

export type ReportVideo = {
  videoId: string
  name: string
  durationSec: number | null
  folderPath: string
  transcript: TranscriptDocument | null
  analysis: AnalysisDocument | null
  retell: RetellDocument | null
  visuals: VisualDocument | null
}

function muted(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, italics: true, color: '5B5B7A', font: 'Calibri' })]
  })
}

export async function buildReportDocx(options: {
  projectName: string
  videos: ReportVideo[]
}): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: options.projectName, font: 'Calibri', bold: true })]
    }),
    new Paragraph({
      spacing: { after: 280 },
      children: [
        new TextRun({
          text: options.videos.length > 1 ? 'Полный отчёт по видео проекта' : 'Полный отчёт',
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
        spacing: { before: 320, after: 120 },
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

    const blocks = video.analysis
      ? video.transcript?.segments.length
        ? rematchOutlineBlocks(video.analysis.blocks, video.transcript.segments)
        : video.analysis.blocks
      : []

    if (blocks.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: 'План с таймингом', font: 'Calibri' })]
        })
      )
      blocks.forEach((block, index) => {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 140, after: 60 },
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
              spacing: { after: 50 },
              children: [new TextRun({ text: line, font: 'Calibri', size: 22 })]
            })
          )
        }
      })
    }

    const frames = (video.visuals?.items ?? []).slice(0, 8)
    if (frames.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: 'Визуальные материалы', font: 'Calibri' })]
        })
      )
      const dir = visualsDir(video.folderPath, video.videoId)
      for (const frame of frames) {
        const imagePath = join(dir, frame.fileName)
        children.push(
          new Paragraph({
            spacing: { before: 120, after: 40 },
            children: [
              new TextRun({
                text: `${clock(frame.start)} · ${frame.description}`,
                font: 'Calibri',
                italics: true,
                color: '5B5B7A'
              })
            ]
          })
        )
        if (existsSync(imagePath)) {
          children.push(
            new Paragraph({
              spacing: { after: 160 },
              children: [
                new ImageRun({
                  type: 'jpg',
                  data: readFileSync(imagePath),
                  transformation: { width: 520, height: 292 }
                })
              ]
            })
          )
        }
      }
    }

    const transcriptText = displayTranscriptText(video.transcript).trim()
    if (!retell && blocks.length === 0 && frames.length === 0) {
      if (transcriptText) {
        children.push(muted('Конспект и кадры ещё не собраны. Ниже — сохранённая расшифровка.'))
        for (const paragraph of transcriptText.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)) {
          children.push(
            new Paragraph({
              spacing: { after: 100 },
              children: [new TextRun({ text: paragraph, font: 'Calibri', size: 22 })]
            })
          )
        }
      } else {
        children.push(muted('По этому видео ещё нет сохранённых материалов.'))
      }
    }
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
    title: `${options.projectName} — полный отчёт`,
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
