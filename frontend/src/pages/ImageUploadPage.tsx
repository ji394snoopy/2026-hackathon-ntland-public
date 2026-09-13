import { useRef, useState } from "react"
import PageHeader from "../components/PageHeader"
import type { SupplementaryImage } from "../types"

function isImageFile(file: File) {
  return file.type.startsWith("image/")
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("無法讀取圖片"))
    reader.readAsDataURL(file)
  })
}

export default function ImageUploadPage({
  images,
  onAddImages,
  onRemoveImage,
  onNext,
}: {
  images: SupplementaryImage[]
  onAddImages: (images: SupplementaryImage[]) => void
  onRemoveImage: (id: string) => void
  onNext: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    const valid = files.filter(isImageFile)
    setError(files.length !== valid.length ? "已略過非圖片檔案" : "")
    if (valid.length === 0) return

    const added = await Promise.all(
      valid.map(async (file) => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        dataUrl: await readAsDataUrl(file),
      })),
    )
    onAddImages(added)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title="補充圖片"
        subtitle="上傳其他想放進報告的圖片檔（現場照片、附件等），將附加於輸出 PDF 末頁"
      />

      <div className="bg-white border-b border-[#D9DCE0] px-5 py-2 flex items-center gap-3 shrink-0">
        <span className="text-[11px] text-[#6B7280]">
          已上傳 <strong className="font-mono">{images.length}</strong> 張
        </span>
        <div className="flex-1" />
        <button
          onClick={onNext}
          className="px-3 py-1 text-[11px] bg-[#12457B] text-white rounded-[4px] hover:bg-[#0F3A66]"
        >
          下一步：輸出 →
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files)
            if (inputRef.current) inputRef.current.value = ""
          }}
        />
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            handleFiles(e.dataTransfer.files)
          }}
          className={`border-2 border-dashed rounded-[4px] p-6 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-[#12457B] bg-[#F0F4F8]"
              : "border-[#D9DCE0] hover:border-[#12457B] hover:bg-[#F0F4F8]"
          }`}
        >
          <div className="text-[#6B7280] text-xs mb-1">
            點擊上傳或拖曳圖片檔案至此（可多選）
          </div>
          <div className="text-[10px] text-[#9CA3AF]">支援 JPG / PNG 等常見圖片格式</div>
        </div>
        {error && <div className="text-[11px] text-[#B7791F]">{error}</div>}

        {images.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="border border-[#D9DCE0] rounded-[4px] bg-white overflow-hidden"
              >
                <div className="aspect-square bg-[#F5F6F7] flex items-center justify-center overflow-hidden">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#6B7280] truncate">{img.name}</span>
                  <button
                    onClick={() => onRemoveImage(img.id)}
                    className="text-[10px] text-[#B7791F] hover:underline shrink-0"
                  >
                    移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
