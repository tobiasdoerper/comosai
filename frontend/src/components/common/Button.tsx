import { CommandBarButton, DefaultButton, IButtonProps, IButtonStyles, ICommandBarStyles } from "@fluentui/react";

interface ShareButtonProps extends IButtonProps {
    onClick: () => void;
  }

export const ShareButton: React.FC<ShareButtonProps> = ({onClick}) => {
    const shareButtonStyles: ICommandBarStyles & IButtonStyles = {
        root: {
          width: 86,
          height: 32,
          borderRadius: 4,
          background: "transparent",//"radial-gradient(109.81% 107.82% at 100.1% 90.19%, #00E6DC 33.63%, #00BEDC 70.31%, #00FFB9 100%)",
        //   position: 'absolute',
        //   right: 20,
          padding: '5px 12px',
          marginRight: '20px'
        },
        icon: {
          color: "var(--bg-color-icon) !important;",
        },
        rootHovered: {
          background: "transparent" //'linear-gradient(135deg, #0F6CBD 0%, #2D87C3 51.04%, #8DDDD8 100%)',
        },
        label: {
          fontWeight: 600,
          fontSize: 14,
          lineHeight: '20px',
          color: "var(--bg-color-headers) !important;",
        },
      };

      return (
        <CommandBarButton
                styles={shareButtonStyles}
                iconProps={{ iconName: 'Share' }}
                onClick={onClick}
                text="Share"
        />
      )
}

interface HistoryButtonProps extends IButtonProps {
    onClick: () => void;
    text: string;
  }

export const HistoryButton: React.FC<HistoryButtonProps> = ({onClick, text}) => {
    const historyButtonStyles: ICommandBarStyles & IButtonStyles = {
        root: {            
            border: "transparent",
            background:"transparent",
            color:"var(--bg-color-headers) !important;"
          },
          rootHovered: {
            border: "transparent",
            background:"transparent",
            color:"var(--bg-color-headers) !important;"
          },
          rootPressed: {
            border: "transparent",
            background:"transparent",
            color:"var(--bg-color-headers) !important;"
          },
      };

      return (
        <DefaultButton
            text={text}
            iconProps={{ iconName: 'History' }}
            onClick={onClick}
            styles={historyButtonStyles}
        />
      )
}
