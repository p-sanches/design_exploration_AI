import { useRef, useCallback, useState } from 'react';
import { useTreeStore } from '../store/tree.js';
import { startBroadcast, stopBroadcast } from '../datalayer/broadcast.js';
import { startCSV, stopCSV } from '../datalayer/csv.js';
import { startMediaPipe, stopMediaPipe } from '../datalayer/mediapipe.js';
import { startBluetooth, stopBluetooth } from '../datalayer/bluetooth.js';
import { ModelUpload } from './ModelUpload.jsx';

export function DataBar() {
  const [webcamReady, setWebcamReady] = useState(false);
  const [showModelUpload, setShowModelUpload] = useState(false);
  const models = useTreeStore(s => s.models);
  const removeModel = useTreeStore(s => s.removeModel);
  const dataSource = useTreeStore(s => s.dataSource);
  const dataFlowing = useTreeStore(s => s.dataFlowing);
  const frameCount = useTreeStore(s => s.frameCount);
  const csvColumns = useTreeStore(s => s.csvColumns);
  const setDataSource = useTreeStore(s => s.setDataSource);
  const setDataFlowing = useTreeStore(s => s.setDataFlowing);
  const incrementFrame = useTreeStore(s => s.incrementFrame);
  const setCsvColumns = useTreeStore(s => s.setCsvColumns);

  const fileRef = useRef(null);
  const videoRef = useRef(null);

  const stopAll = useCallback(() => {
    stopBroadcast();
    stopCSV();
    stopMediaPipe();
    stopBluetooth().catch(() => {});
    setDataFlowing(false);
    setWebcamReady(false);
  }, [setDataFlowing]);

  const handleSourceChange = useCallback((source) => {
    stopAll();
    setDataSource(source);

    if (source === 'csv') {
      fileRef.current?.click();
    } else if (source === 'mediapipe') {
      // videoRef is attached to the <video> rendered in JSX below
      const waitForRef = () => {
        const vid = videoRef.current;
        if (!vid) { setTimeout(waitForRef, 50); return; }
        startMediaPipe(vid)
          .then(() => {
            startBroadcast(() => { incrementFrame(); });
            setDataFlowing(true);
            setWebcamReady(true);
          })
          .catch(e => console.error('MediaPipe error:', e));
      };
      waitForRef();
    } else if (source === 'bluetooth') {
      startBluetooth()
        .then(() => {
          startBroadcast(() => {
            incrementFrame();
          });
          setDataFlowing(true);
        })
        .catch(e => console.error('Bluetooth error:', e));
    }
  }, [stopAll, setDataSource, setDataFlowing, incrementFrame]);

  const handleCSVFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // PapaParse loaded from CDN
    window.Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const columns = results.meta.fields || [];
        setCsvColumns(columns);
        startCSV(results.data, columns, null);
        startBroadcast(() => { incrementFrame(); });
        setDataFlowing(true);
      },
      error: (err) => console.error('CSV parse error:', err),
    });
  }, [setCsvColumns, incrementFrame, setDataFlowing]);

  return (
    <div className="data-bar">
      <div className="data-bar-left">
        <span className="data-bar-title">Connect data</span>
        <button
          className={dataSource === 'csv' ? 'active' : ''}
          onClick={() => handleSourceChange('csv')}
        >
          CSV file
        </button>
        <button
          className={dataSource === 'mediapipe' ? 'active' : ''}
          onClick={() => handleSourceChange('mediapipe')}
        >
          Webcam
        </button>
        <button
          className={dataSource === 'bluetooth' ? 'active' : ''}
          onClick={() => handleSourceChange('bluetooth')}
        >
          Sensor
        </button>
        {dataSource !== 'none' && (
          <button className="stop-btn" onClick={() => { stopAll(); setDataSource('none'); }}>
            Stop
          </button>
        )}
      </div>
      <div className="data-bar-models">
        {models.map(m => (
          <span key={m.id} className="model-pill" title={`${m.format.toUpperCase()} — ${m.inputDescription || 'no input description'}`}>
            {m.name}
            <button className="model-pill-x" onClick={() => removeModel(m.id)}>&times;</button>
          </span>
        ))}
        <button className="model-add-btn" onClick={() => setShowModelUpload(true)}>Add model</button>
      </div>
      <div className="data-bar-right">
        {dataFlowing && (
          <>
            <span className="pulse" />
            <span className="frame-count">{frameCount} frames</span>
          </>
        )}
        {csvColumns.length > 0 && (
          <span className="csv-cols" title={csvColumns.join(', ')}>
            {csvColumns.length} columns
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVFile} hidden />
      {dataSource === 'mediapipe' && (
        <video ref={videoRef} className="webcam-preview" autoPlay playsInline muted style={{ display: webcamReady ? 'block' : 'none' }} />
      )}
      {showModelUpload && <ModelUpload onClose={() => setShowModelUpload(false)} />}
    </div>
  );
}
