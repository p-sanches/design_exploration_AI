import { useState, useRef } from 'react';
import { useTreeStore } from '../store/tree.js';

const FORMAT_MAP = {
  'onnx': 'onnx',
  'json': 'tfjs',
  'js': 'js',
};

export function ModelUpload({ onClose }) {
  const addModel = useTreeStore(s => s.addModel);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [outputLabels, setOutputLabels] = useState('');
  const [inputDescription, setInputDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    if (!name) {
      setName(f.name.replace(/\.(onnx|json|js)$/i, ''));
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const format = FORMAT_MAP[ext];
    if (!format) {
      setError(`Unsupported format ".${ext}". Use .onnx, .json (TF.js), or .js`);
      return;
    }
    const labels = outputLabels.split(',').map(s => s.trim()).filter(Boolean);
    setUploading(true);
    setError(null);
    try {
      await addModel(file, name || file.name, format, inputDescription, labels);
      onClose();
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  return (
    <div className="model-upload-overlay" onClick={onClose}>
      <div className="model-upload-modal" onClick={e => e.stopPropagation()}>
        <div className="model-upload-header">
          <span>Add a model</span>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="model-upload-body">
          <div className="model-upload-field">
            <label>Model file</label>
            <button className="model-upload-file-btn" onClick={() => fileRef.current?.click()}>
              {file ? file.name : 'Choose file...'}
            </button>
            <input ref={fileRef} type="file" accept=".onnx,.json,.js" onChange={handleFileChange} hidden />
          </div>

          <div className="model-upload-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. my-classifier"
            />
          </div>

          <div className="model-upload-field">
            <label>Output labels <span className="model-upload-hint">(comma-separated)</span></label>
            <input
              type="text"
              value={outputLabels}
              onChange={e => setOutputLabels(e.target.value)}
              placeholder="e.g. standing, sitting, walking"
            />
          </div>

          <div className="model-upload-field">
            <label>Input description <span className="model-upload-hint">(optional)</span></label>
            <input
              type="text"
              value={inputDescription}
              onChange={e => setInputDescription(e.target.value)}
              placeholder="e.g. 6 sensor values or 99 features"
            />
          </div>

          <div className="model-upload-help">
            <strong>Supported formats:</strong> ONNX (.onnx), TensorFlow.js (.json), Custom JS (.js)
            <br />
            Python models (.pkl, .joblib) must be converted to ONNX first using{' '}
            <code>skl2onnx</code> or <code>tf2onnx</code>.
          </div>

          {error && <div className="model-upload-error">{error}</div>}
        </div>

        <div className="model-upload-footer">
          <button onClick={onClose}>Cancel</button>
          <button
            className="model-upload-submit"
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
