
// useState removed
interface OCRButtonProps {
    onClick: () => void;
    status: 'idle' | 'loading' | 'processing' | 'done' | 'error';
    progress?: { current: number; total: number; status: string };
    disabled?: boolean;
}

export const OCRButton = ({ onClick, status, progress, disabled }: OCRButtonProps) => {
    return (
        <div className="ocr-controls" style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 1000,
            background: 'white',
            padding: '10px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            minWidth: '200px'
        }}>
            <div className="status-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>AI OCR</span>
                {status !== 'idle' && (
                    <span
                        className={`status-badge ${status}`}
                        style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: status === 'done' ? '#e6fffa' : '#ebf8ff',
                            color: status === 'done' ? '#2c7a7b' : '#2b6cb0'
                        }}
                    >
                        {status.toUpperCase()}
                    </span>
                )}
            </div>

            {/* Progress was moved to ProgressBar component */}



            <button
                onClick={onClick}
                disabled={disabled || status === 'loading' || status === 'processing'}
                style={{
                    padding: '8px 16px',
                    background: '#3182ce',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.6 : 1,
                    fontSize: '14px',
                    fontWeight: 500,
                    transition: 'background 0.2s'
                }}
            >
                {status === 'idle' ? 'Start OCR' :
                    status === 'processing' ? 'Processing...' :
                        status === 'done' ? 'Done' : 'Start OCR'}
            </button>
        </div>
    );
};
