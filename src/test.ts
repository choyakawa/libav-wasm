// @ts-ignore
import { createFile } from 'mp4box'
import PQueue from 'p-queue'

import { bufferStream, SEEK_WHENCE_FLAG, throttleWithLastCall } from './utils'
import { makeTransmuxer } from '.'
import { MP4Info } from './mp4box'

type Chunk = {
  offset: number
  buffer: Uint8Array
  pts: number
  duration: number
  pos: number
  buffered: boolean
}

const BUFFER_SIZE = 5_000_000
const VIDEO_URL = '../video2.mkv'

// export const fetchMedia =
//     (size: number, bufferSize: number, offset: number) =>
//       fetch(VIDEO_URL, { headers: { Range: `bytes=${offset}-${size}` } })
//         .then(res => {
//           if (!res.body) throw new Error('no body')
//           return {
//             ...res,
//             body: bufferStream({ stream: res.body, size: bufferSize })
//           }
//         })

fetch(VIDEO_URL, { headers: { Range: `bytes=0-1` } })
  .then(async ({ headers, body }) => {
    if (!body) throw new Error('no body')
    const contentRangeContentLength = headers.get('Content-Range')?.split('/').at(1)
    const contentLength =
      contentRangeContentLength
        ? Number(contentRangeContentLength)
        : Number(headers.get('Content-Length'))

    // const buffer = await new Response(body).arrayBuffer()

    // let reader = bufferStream({ stream: body, size: BUFFER_SIZE }).getReader()
    let mp4boxfile = createFile()
    mp4boxfile.onError = (error: Error) => console.error('mp4box error', error)

    let _resolveInfo: (value: unknown) => void
    const infoPromise = new Promise((resolve) => { _resolveInfo = resolve })

    let mime = 'video/mp4; codecs=\"'
    let info: any | undefined
    mp4boxfile.onReady = (_info: MP4Info) => {
      console.log('mp4box ready info', _info)
      info = _info
      for (let i = 0; i < info.tracks.length; i++) {
        if (i !== 0) mime += ','
        mime += info.tracks[i].codec
      }
      mime += '\"'
      _resolveInfo(info)
    }

    let headerChunk: Chunk
    let chunks: Chunk[] = []
    let initDone = false


    const transmuxer = await makeTransmuxer({
      bufferSize: BUFFER_SIZE,
      sharedArrayBufferSize: BUFFER_SIZE + 1_000_000,
      length: contentLength,
      read: async (offset, size) => {

        // console.group()
        // console.log('READ TESTTTTTTT', offset, size)
        // // console.log('read', offset, size)
        // const buffer2 = await (await fetch(VIDEO_URL, { headers: { Range: `bytes=${offset}-${Math.min(offset + size, contentLength) - 1}` } })).arrayBuffer()
        // // return new Uint8Array(buffer)

        // // console.log('read', offset, size)
        // await new Promise(resolve => setTimeout(resolve, 200))
        // const buff = new Uint8Array(buffer.slice(Number(offset), offset + size))
        // console.log(buffer2)
        // console.log(buff)
        // console.groupEnd()

        // return buff


        const buffer = await (await fetch(VIDEO_URL, { headers: { Range: `bytes=${offset}-${Math.min(offset + size, contentLength) - 1}` } })).arrayBuffer()
        console.log('read', offset, size, new Uint8Array(buffer))
        return new Uint8Array(buffer)


        // const { value, done } = await reader.read()
        // console.log('value', value, done)
        // if (!value) throw new Error('no value')
        // if (done) return new Uint8Array(0)
        // const buff = new Uint8Array(value)
        // console.log('read', offset, size)
        // return buff
      },
      seek: async (currentOffset, offset, whence) => {
        console.log('seek', currentOffset, offset, whence)
        if (whence === SEEK_WHENCE_FLAG.SEEK_CUR) {
          return currentOffset + offset;
        }
        if (whence === SEEK_WHENCE_FLAG.SEEK_END) {
          return -1
        }
        if (whence === SEEK_WHENCE_FLAG.SEEK_SET) {
          // little trick to prevent libav from requesting end of file data on init that might take a while to fetch
          if (!initDone && offset > (contentLength - 1_000_000)) return -1
          // await reader.cancel()
          // const res = await fetchMedia(contentLength, BUFFER_SIZE, offset)
          // reader = bufferStream({ stream: res.body, size: BUFFER_SIZE }).getReader()
          return offset;
        }
        if (whence === SEEK_WHENCE_FLAG.AVSEEK_SIZE) {
          return contentLength;
        }
        return -1
      },
      subtitle: (title, language, subtitle) => {
        // console.log('SUBTITLE HEADER', title, language, subtitle)
      },
      attachment: (filename: string, mimetype: string, buffer: ArrayBuffer) => {
        console.log('attachment', filename, mimetype, buffer)
      },
      write: ({ isHeader, offset, buffer, pts, duration, pos }) => {
        console.log('write', isHeader, offset, pts, duration, pos)
        // console.log('receive write', isHeader, offset, pts, duration, pos, new Uint8Array(buffer))
        if (isHeader) {
          if (!headerChunk) {
            headerChunk = {
              offset,
              buffer: new Uint8Array(buffer),
              pts,
              duration,
              pos,
              buffered: false
            }
          }
          return
        }
        chunks = [
          ...chunks,
          {
            offset,
            buffer: new Uint8Array(buffer),
            pts,
            duration,
            pos,
            buffered: false
          }
        ]
      }
    })
    console.log('mt transmuxer', transmuxer)

    await transmuxer.init()
    initDone = true

    console.log('init finished')

    // @ts-ignore
    if (!headerChunk) throw new Error('No header chunk found after transmuxer init')

    // @ts-ignore
    headerChunk.buffer.buffer.fileStart = 0
    console.log('APPEND MP4BOX', headerChunk.buffer)
    mp4boxfile.appendBuffer(headerChunk.buffer.buffer)

    const duration = (await transmuxer.getInfo()).input.duration / 1_000_000

    await infoPromise

    console.log('DURATION', duration)

    const video = document.createElement('video')
    const seconds = document.createElement('div')
    // video.autoplay = true
    video.controls = true
    video.volume = 0
    video.addEventListener('error', ev => {
      // @ts-ignore
      console.error(ev.target?.error)
    })
    document.body.appendChild(video)
    document.body.appendChild(seconds)
    
    setInterval(() => {
      seconds.textContent = video.currentTime.toString()
    }, 100)

    const mediaSource = new MediaSource()
    video.src = URL.createObjectURL(mediaSource)

    const sourceBuffer: SourceBuffer =
      await new Promise(resolve =>
        mediaSource.addEventListener(
          'sourceopen',
          () => resolve(mediaSource.addSourceBuffer(mime)),
          { once: true }
        )
      )

    mediaSource.duration = duration
    sourceBuffer.mode = 'segments'

    const queue = new PQueue({ concurrency: 1 })

    const setupListeners = (resolve: (value: Event) => void, reject: (reason: Event) => void) => {
      const updateEndListener = (ev: Event) => {
        resolve(ev)
        unregisterListeners()
      }
      const abortListener = (ev: Event) => {
        resolve(ev)
        unregisterListeners()
      }
      const errorListener = (ev: Event) => {
        reject(ev),
        unregisterListeners()
      }
      const unregisterListeners = () => {
        sourceBuffer.removeEventListener('updateend', updateEndListener)
        sourceBuffer.removeEventListener('abort', abortListener)
        sourceBuffer.removeEventListener('error', errorListener)
      }
      sourceBuffer.addEventListener('updateend', updateEndListener, { once: true })
      sourceBuffer.addEventListener('abort', abortListener, { once: true })
      sourceBuffer.addEventListener('error', errorListener, { once: true })
    }

    // const getTimeRanges = () =>
    //   Array(sourceBuffer.buffered.length)
    //     .fill(undefined)
    //     .map((_, index) => ({
    //       index,
    //       start: sourceBuffer.buffered.start(index),
    //       end: sourceBuffer.buffered.end(index)
    //     }))

    // const getTimeRange = (time: number) =>
    //   getTimeRanges()
    //     .find(({ start, end }) => time >= start && time <= end)

    const appendBuffer = (buffer: ArrayBuffer) =>
      queue.add(() =>
        new Promise<Event>((resolve, reject) => {
          setupListeners(resolve, reject)
          sourceBuffer.appendBuffer(buffer)
        })
      )

    const bufferChunk = async (chunk: Chunk) => {
      // sourceBuffer.appendWindowStart = chunk.pts
      // sourceBuffer.appendWindowEnd = chunk.pts + chunk.duration
      await appendBuffer(chunk.buffer.buffer)
      // sourceBuffer.appendWindowStart = Infinity
      // sourceBuffer.appendWindowEnd = 0
      chunk.buffered = true
    }

    
    const unbufferChunk = async (chunk: Chunk) =>
      queue.add(() =>
        new Promise((resolve, reject) => {
          setupListeners(resolve, reject)

          const chunkIndex = chunks.indexOf(chunk)
          if (chunkIndex === -1) return reject('No chunk found')
          sourceBuffer.remove(chunk.pts, chunk.pts + chunk.duration)
          chunk.buffered = false
        })
      )

    const removeChunk = async (chunk: Chunk) => {
      const chunkIndex = chunks.indexOf(chunk)
      if (chunkIndex === -1) throw new RangeError('No chunk found')
      await unbufferChunk(chunk)
      chunks = chunks.filter(_chunk => _chunk !== chunk)
    }

    // const removeRange = ({ start, end, index }: { start: number, end: number, index: number }) =>
    //   queue.add(() =>
    //     new Promise((resolve, reject) => {
    //       setupListeners(resolve, reject)
    //       sourceBuffer.remove(
    //         Math.max(sourceBuffer.buffered.start(index), start),
    //         Math.min(sourceBuffer.buffered.end(index), end)
    //       )
    //     })
    //   )

    // const clearBufferedRanges = async () => {
    //   const bufferedRanges = getTimeRanges()
    //   for (const range of bufferedRanges) {
    //     await removeRange(range)
    //   }
    // }

    const PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS = 15
    const POST_SEEK_NEEDED_BUFFERS_IN_SECONDS = 30
    const POST_SEEK_REMOVE_BUFFERS_IN_SECONDS = 60

    const processNeededBufferRange = throttleWithLastCall(100, async () => {
      const currentTime = video.currentTime
      let lastPts = chunks.sort(({ pts }, { pts: pts2 }) => pts - pts2).at(-1)?.pts
      while (lastPts === undefined || (lastPts < (currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS))) {
        // console.log('lastPts', lastPts, currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS)
        const newChunks = await process()
        const lastProcessedChunk = newChunks.at(-1)
        if (!lastProcessedChunk) break
        lastPts = lastProcessedChunk.pts
      }
    })

    const seek = throttleWithLastCall(500, async (time: number) => {
      // console.log('seek', time)
      const isPlaying = !video.paused
      if (isPlaying) video.pause()
      const allTasksDone = new Promise(resolve => {
        processingQueue.size && processingQueue.pending
          ? (
            processingQueue.on(
              'next',
              () =>
                processingQueue.pending === 0
                  ? resolve(undefined)
                  : undefined
            )
          )
          : resolve(undefined)
      })
      processingQueue.pause()
      processingQueue.clear()
      await allTasksDone
      initDone = false
      // console.log('destroy')
      await transmuxer.destroy()
      // console.log('destroy done')
      await transmuxer.init()
      // console.log('init done')
      initDone = true
      processingQueue.start()
      // console.log('init processing')
      await process()
      await process()
      // console.log('init processing done')

      chunks = []
      // await clearBufferedRanges()

      // console.log('init seeking')
      await transmuxer.seek(Math.max(0, time - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS))
      // console.log('init seek processing done')

      await processNeededBufferRange()
      await updateBufferedRanges()

      if (isPlaying) await video.play()

      await new Promise(resolve => setTimeout(resolve, 100))

      await processNeededBufferRange()
      await updateBufferedRanges()

      // console.log('seek done', time)
    })

    const processingQueue = new PQueue({ concurrency: 1 })

    const process = () =>
      processingQueue.add(() =>
        transmuxer.process(BUFFER_SIZE)
      )

    const updateBufferedRanges = async () => {
      const { currentTime } = video
      const neededChunks =
        chunks
          .filter(({ pts, duration }) =>
            ((currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS) < pts)
            && ((currentTime + POST_SEEK_REMOVE_BUFFERS_IN_SECONDS) > (pts + duration))
          )

      const shouldBeBufferedChunks =
        neededChunks
          .filter(({ pts, duration }) =>
            ((currentTime - PRE_SEEK_NEEDED_BUFFERS_IN_SECONDS) < pts)
            && ((currentTime + POST_SEEK_NEEDED_BUFFERS_IN_SECONDS) > (pts + duration))
          )

      const shouldBeUnbufferedChunks = 
        chunks
          .filter(({ buffered }) => buffered)
          .filter((chunk) => !shouldBeBufferedChunks.includes(chunk))

      const nonNeededChunks =
        chunks
          .filter((chunk) => !neededChunks.includes(chunk))

      for (const shouldBeUnbufferedChunk of shouldBeUnbufferedChunks) {
        await unbufferChunk(shouldBeUnbufferedChunk)
      }
      for (const nonNeededChunk of nonNeededChunks) {
        await removeChunk(nonNeededChunk)
      }
      for (const chunk of shouldBeBufferedChunks) {
        if (chunk.buffered) continue
        try {
          await bufferChunk(chunk)
        } catch (err) {
          if (!(err instanceof Event)) throw err
          // if (err.message !== 'Failed to execute \'appendBuffer\' on \'SourceBuffer\': This SourceBuffer is still processing an \'appendBuffer\' or \'remove\' operation.') throw err
          break
        }
      }
    }

    // @ts-ignore
    await appendBuffer(headerChunk.buffer)

    await processNeededBufferRange()
    await updateBufferedRanges()

    video.addEventListener('seeking', () => {
      seek(video.currentTime)
    })

    video.addEventListener('timeupdate', throttleWithLastCall(500, async () => {
      await processNeededBufferRange()
      await updateBufferedRanges()
    }))

    setTimeout(() => {
      video.play()
    }, 2_500)
  })
