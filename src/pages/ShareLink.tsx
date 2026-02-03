import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ShareLink() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleValidate = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.request<{ targetUrl: string }>("/api/share-links/validate", {
        method: "POST",
        body: JSON.stringify({ token, pin }),
      });
      if (response?.targetUrl) {
        window.location.href = response.targetUrl;
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err?.message || "Invalid PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          Enter PIN to access shared link
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          This content is protected. Enter the 6‑digit PIN provided to you.
        </p>
        <Input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder="PIN (6+ digits)"
        />
        {error && (
          <p className="text-xs text-rose-500 mt-2">{error}</p>
        )}
        <Button
          className="w-full mt-4"
          onClick={handleValidate}
          disabled={loading || pin.length < 6}
        >
          {loading ? "Validating..." : "Unlock"}
        </Button>
      </div>
    </div>
  );
}
