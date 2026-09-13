import { useEffect, useRef, useState } from "react"

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
}

export default function PdfUpload({
  label,
  hint,
  disabled,
  onFileChange,
}: {
  label: string
  hint: string
  disabled?: boolean
  onFileChange?: (file: File | null) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [showPreview, setShowPreview] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  const handleSelected = (selected: File | undefined | null) => {
    if (!selected) return
    if (!isPdfFile(selected)) {
      setError("僅接受 PDF 檔案")
      return
    }
    setError("")
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(selected)
    })
    setFile(selected)
    setShowPreview(true)
    onFileChange?.(selected)
  }

  const handleRemove = () => {
    if (url) URL.revokeObjectURL(url)
    setFile(null)
    setUrl(null)
    setShowPreview(false)
    setError("")
    if (inputRef.current) inputRef.current.value = ""
    onFileChange?.(null)
  }

  return (
    <div>
      <label className="block text-[11px] text-[#6B7280] mb-1">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        disabled={disabled}
        onChange={(e) => handleSelected(e.target.files?.[0])}
      />
      {file ? (
        <div className="border border-[#2E7D32] bg-green-50 rounded-[4px] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[#2E7D32] text-sm font-medium truncate">✓ {file.name}</div>
              <div className="text-[10px] text-[#6B7280] mt-0.5">{(file.size / 1024).toFixed(0)} KB</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                disabled={disabled}
                className="text-[11px] text-[#12457B] hover:underline disabled:opacity-50"
              >
                {showPreview ? "隱藏預覽" : "查看 PDF"}
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={disabled}
                className="text-[11px] text-[#B7791F] hover:underline disabled:opacity-50"
              >
                移除
              </button>
            </div>
          </div>
          {showPreview && url && (
            <iframe
              title={`${label} 預覽`}
              src={url}
              className="w-full h-96 mt-3 border border-[#D9DCE0] rounded-[4px] bg-white"
            />
          )}
        </div>
      ) : (
        <div
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (!disabled) handleSelected(e.dataTransfer.files?.[0])
          }}
          className={`border-2 border-dashed rounded-[4px] p-5 text-center transition-colors ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          } ${isDragging ? "border-[#12457B] bg-[#F0F4F8]" : "border-[#D9DCE0] hover:border-[#12457B] hover:bg-[#F0F4F8]"}`}
        >
          <div className="text-[#6B7280] text-xs mb-1">點擊上傳或拖曳 PDF 檔案至此</div>
          <div className="text-[10px] text-[#9CA3AF]">{hint}</div>
        </div>
      )}
      {error && <div className="text-[11px] text-[#B7791F] mt-1.5">{error}</div>}
    </div>
  )
}
