import { useCallback, useState } from 'react'
import {
  detectUploadKind,
  readFileAsBase64,
  readFileAsText,
  validateUploadFile,
} from './hmda-cohi-client.js'

export function useHmdaCohiAnalyst(theme) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [digest, setDigest] = useState(null)
  const [filename, setFilename] = useState('')
  const [messages, setMessages] = useState([])
  const [stagedFile, setStagedFile] = useState(null)

  const appendAssistant = useCallback((content) => {
    setMessages((prev) => [...prev, { role: 'assistant', content }])
  }, [])

  const runAnalyze = useCallback(
    async (kind, file, userNote = '') => {
      setBusy(true)
      setError('')
      setDigest(null)
      setFilename(file.name)
      setStagedFile(null)
      const userLine = userNote.trim()
        ? `Uploaded ${kind.toUpperCase()}: ${file.name}\n${userNote.trim()}`
        : `Uploaded ${kind.toUpperCase()}: ${file.name}`
      setMessages([{ role: 'user', content: userLine }])

      try {
        await validateUploadFile(kind, file)
        const payload = kind === 'csv' ? await readFileAsText(file) : await readFileAsBase64(file)

        const res = await fetch('/api/hmda/cohi/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            filename: file.name,
            payload,
            hmdaContext: theme?.hmdaContext || {},
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Analyze failed (${res.status})`)

        setDigest(data.digest ?? null)
        appendAssistant(data.reply || '')
      } catch (e) {
        setError(e?.message || 'Upload failed')
        appendAssistant(`Could not analyze file: ${e?.message || 'Unknown error'}`)
      } finally {
        setBusy(false)
      }
    },
    [appendAssistant, theme],
  )

  const sendChat = useCallback(
    async (text) => {
      const t = String(text || '').trim()
      if (!t || busy) return false

      const nextHistory = [...messages, { role: 'user', content: t }]
      setMessages(nextHistory)
      setBusy(true)
      setError('')

      try {
        const res = await fetch('/api/hmda/cohi/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: nextHistory,
            digest,
            hmdaContext: theme?.hmdaContext || {},
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Chat failed (${res.status})`)
        appendAssistant(data.reply || '')
        return true
      } catch (e) {
        setError(e?.message || 'Chat failed')
        appendAssistant(`Error: ${e?.message || 'Unknown error'}`)
        return false
      } finally {
        setBusy(false)
      }
    },
    [appendAssistant, busy, digest, messages, theme],
  )

  const stageFile = useCallback((file) => {
    const kind = detectUploadKind(file)
    if (!kind) {
      setError('Use CSV or Excel (.xlsx / .xls) only.')
      return
    }
    setStagedFile({ file, kind })
    setError('')
  }, [])

  const clearStaged = useCallback(() => setStagedFile(null), [])

  const resetAnalyst = useCallback(() => {
    setMessages([])
    setDigest(null)
    setFilename('')
    setError('')
    setStagedFile(null)
  }, [])

  const submitAnalyst = useCallback(
    async (draft) => {
      if (busy) return
      if (stagedFile) {
        await runAnalyze(stagedFile.kind, stagedFile.file, draft)
        return
      }
      if (draft?.trim()) {
        await sendChat(draft.trim())
      }
    },
    [busy, runAnalyze, sendChat, stagedFile],
  )

  return {
    busy,
    error,
    digest,
    filename,
    messages,
    stagedFile,
    stageFile,
    clearStaged,
    resetAnalyst,
    submitAnalyst,
    runAnalyze,
    sendChat,
  }
}
