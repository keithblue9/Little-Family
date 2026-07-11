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
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be smaller than 5MB");
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result);
    };
    reader.readAsDataURL(file);

    // Upload
    setUploading(true);
    try {
      // In production, upload to storage service (S3, Firebase, etc)
      // For now, we'll use the base64 directly
      const photoUrl = reader.result;
      await api.post(`/children/${childId}/profile-photo`, {
        photo_url: photoUrl,
      });
      toast.success("Profile photo updated!");
    } catch (err) {
      toast.error(formatApiError(err));
      setPreview(currentPhoto || null);
    } finally {
      setUploading(false);
    }
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
              JPG, PNG or GIF (max 5MB)
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
