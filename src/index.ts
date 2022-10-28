import type { Resolvers as WorkerResolvers } from './worker'

import PQueue from 'p-queue'
import { call } from 'osra'

import { Operation } from './shared-buffer_generated'
import { getSharedInterface, notifyInterface, setSharedInterface, State, waitForInterfaceNotification } from './utils'

/** https://ffmpeg.org/doxygen/trunk/avformat_8h.html#ac736f8f4afc930ca1cda0b43638cc678 */
export enum SEEK_FLAG {
  NONE = 0,
  /** seek backward */
  AVSEEK_FLAG_BACKWARD = 1 << 0,
  /** seeking based on position in bytes */
  AVSEEK_FLAG_BYTE = 1 << 1,
  /** seek to any frame, even non-keyframes */
  AVSEEK_FLAG_ANY = 1 << 2,
  /** seeking based on frame number */
  AVSEEK_FLAG_FRAME = 1 << 3
}

export enum SEEK_WHENCE_FLAG {
  SEEK_SET = 0,
  SEEK_CUR = 1 << 0,
  SEEK_END = 1 << 1,
  AVSEEK_SIZE = 1 << 16 //0x10000,
}

export type MakeTransmuxerOptions = {
  read: (offset: number, size: number) => Promise<Uint8Array>
  seek: (offset: number, whence: SEEK_WHENCE_FLAG) => Promise<number>
  length: number
  sharedArrayBufferSize: number
  bufferSize: number
}

export const makeTransmuxer = async ({
  read: _read,
  seek: _seek,
  length,
  sharedArrayBufferSize = 10_000_000,
  bufferSize = 1_000_000
}: MakeTransmuxerOptions) => {
  const sharedArrayBuffer = new SharedArrayBuffer(sharedArrayBufferSize)
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  console.log('mt sharedArrayBuffer', sharedArrayBuffer)

  await new Promise((resolve, reject) => {
    const onMessage = (message: MessageEvent) => {
      if (message.data !== 'init') return
      resolve(undefined)
      worker.removeEventListener('message', onMessage)
    }
    worker.addEventListener('message', onMessage)
    setTimeout(reject, 30_000)
  })

  const target = call<WorkerResolvers>(worker)

  const blockingQueue = new PQueue({ concurrency: 1 })
  const apiQueue = new PQueue()

  const addBlockingTask = <T>(task: (...args: any[]) => T) =>
    blockingQueue.add(async () => {
      apiQueue.pause()
      try {
        return await task()
      } finally {
        apiQueue.start()
      }
    })

  const addTask = <T extends (...args: any) => any>(func: T) =>
    apiQueue.add<Awaited<ReturnType<T>>>(func)
  
  const { init: workerInit, process: workerProcess, seek: workerSeek } =
    await target(
      'init',
      {
        length,
        sharedArrayBuffer,
        bufferSize,
        write: (buffer: Uint8Array) => {
          console.log('receive write', buffer)
        }
      }
    )

  const seek = async (offset: number, whence: SEEK_WHENCE_FLAG) => {
    const resultOffset = await _seek(offset, whence)
    console.log('MT SEEK SETTING VALUE')
    setSharedInterface(sharedArrayBuffer, {
      operation: Operation.Read,
      offset: resultOffset,
      argOffset: 0,
      argWhence: 0
    })
    console.log('MT SEEK NOTIFYING RESPONDED')
    notifyInterface(sharedArrayBuffer, State.Responded)
  }

  const read = async (offset: number, size: number) => {
    const readResultBuffer = await _read(offset, size)
    console.log('MT READ SETTING VALUE')
    setSharedInterface(sharedArrayBuffer, {
      operation: Operation.Read,
      buffer: readResultBuffer,
      argOffset: offset,
      argBufferSize: 0
    })
    console.log('MT READ NOTIFYING RESPONDED')
    notifyInterface(sharedArrayBuffer, State.Responded)
  }

  const waitForTransmuxerCall = async () => {
    const result = await waitForInterfaceNotification(sharedArrayBuffer, State.Idle)

    if (result === 'not-equal') {
      setTimeout(waitForTransmuxerCall, 1)
      return
    }

    const responseSharedInterface = getSharedInterface(sharedArrayBuffer)
    const operation = responseSharedInterface.operation()
    console.log('NEW REQUEST', result, [...new Uint8Array(sharedArrayBuffer.slice(0, 5))])
    if (operation === Operation.Read) {
      await addBlockingTask(() =>
        read(
          responseSharedInterface.argOffset(),
          responseSharedInterface.argBufferSize()
        )
      )
    }
    if (operation === Operation.Seek) {
      await addBlockingTask(() =>
        seek(
          responseSharedInterface.argOffset(),
          responseSharedInterface.argWhence()
        )
      )
    }
    waitForTransmuxerCall()
  }

  waitForTransmuxerCall()

  return {
    init: () => workerInit(),
    process: () => workerProcess()
  }
}

export default makeTransmuxer
