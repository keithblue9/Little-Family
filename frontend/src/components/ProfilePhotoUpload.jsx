import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Upload, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";

export default function ProfilePhotoUpload({ childId, childName, currentPhoto }) {
  const [preview, setPreview] = useState(currentPhoto || null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Pilih file gambar ya");
      return;
    }

    // Validate file size (max 2.5MB — base64 encoding inflates this ~33%,
    // and serverless platforms typically cap request bodies around 4-4.5MB)
    if (file.size > 2.5 * 1024 * 1024) {
      toast.error("Ukuran gambar maksimal 2.5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const photoUrl = e.target?.result;
      if (!photoUrl) {
        toast.error("Gagal membaca gambar, coba lagi ya");
        return;
      }
      setPreview(photoUrl);
      setUploading(true);
      try {
        await api.post(`/children/${childId}/profile-photo`, { photo_url: photoUrl });
        toast.success("Foto profil berhasil diperbarui!");
      } catch (err) {
        toast.error(formatApiError(err));
        setPreview(currentPhoto || null);
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      toast.error("Gagal membaca file gambar");
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = async () => {
    if (!window.confirm("Remove profile photo?")) return;

    setUploading(true);
    try {
      await api.post(`/children/${childId}/profile-photo`, {
        photo_url: null,
      });
      setPreview(null);
      toast.success("Profile photo removed");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="font-fun font-bold text-lg text-slate-900 flex items-center gap-2">
        <Camera className="w-5 h-5 text-pink-500" />
        Profile Photo
      </h3>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl p-6 border-2 border-slate-100 flex flex-col items-center gap-4"
      >
        {preview ? (
          <>
            <motion.img
              src={preview}
              alt={childName}
              className="w-32 h-32 rounded-2xl object-cover border-4 border-slate-100"
              layoutId="profilePhoto"
            />
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-orange-500 text-white font-fun font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                Change Photo
              </button>
              <button
                onClick={handleRemovePhoto}
                disabled={uploading}
                className="px-4 py-2 bg-red-100 text-red-600 font-fun font-semibold rounded-lg hover:bg-red-200 disabled:opacity-50 flex items-center gap-2"
              >
                <X className="w-4 h-4" /> Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-32 h-32 rounded-2xl bg-slate-100 flex items-center justify-center">
              <Camera className="w-12 h-12 text-slate-300" />
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-6 py-3 bg-orange-500 text-white font-fun font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Upload Photo
            </button>
            <p className="text-sm text-slate-500 text-center">
              JPG, PNG, atau GIF (maks 2.5MB)
            </p>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
      </motion.div>
    </div>
  );
}
