import React from 'react';

interface ProgressBarProps {
    current: number;
    total: number;
    statusText: string;
    isActive: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ current, total, statusText, isActive }) => {
    const percentage = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;

    if (!isActive && percentage === 0) return null;

    return (
        <div className="progress-container" style={{
            width: '100%',
            padding: '10px 20px',
            background: '#f7fafc',
            borderBottom: '1px solid #e2e8f0'
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '5px',
                fontSize: '12px',
                color: '#4a5568',
                fontWeight: 500
            }}>
                <span>{statusText.toUpperCase()}</span>
                <span>{Math.round(percentage)}%</span>
            </div>
            <div style={{
                height: '6px',
                background: '#edf2f7',
                borderRadius: '3px',
                overflow: 'hidden',
                position: 'relative'
            }}>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    width: `${percentage}%`,
                    background: percentage === 100 ? '#48bb78' : '#3182ce',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease-out, background 0.3s'
                }} />
                {isActive && percentage < 100 && (
                    <div className="progress-stripe" style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)',
                        backgroundSize: '1rem 1rem',
                        animation: 'progress-stripe 1s linear infinite',
                        opacity: 0.3
                    }} />
                )}
            </div>
            <style>{`
                @keyframes progress-stripe {
                    0% { background-position: 1rem 0; }
                    100% { background-position: 0 0; }
                }
            `}</style>
        </div>
    );
};
