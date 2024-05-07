import { useContext, useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Checkbox, CommandBarButton, Dialog, Stack, TextField, Toggle } from '@fluentui/react'
import { CopyRegular } from '@fluentui/react-icons'

import { CosmosDBStatus } from '../../api'
import Contoso from '../../assets/comos.png'
import { HistoryButton, ShareButton } from '../../components/common/Button'
import { AppStateContext } from '../../state/AppProvider'
import Switch from "react-switch";
import packageJSON from '../../../package.json';

import styles from './Layout.module.css'
import { version } from 'dompurify'

const Layout = () => {
    const [isSharePanelOpen, setIsSharePanelOpen] = useState<boolean>(false)
    const [copyClicked, setCopyClicked] = useState<boolean>(false)
    const [isDarkTheme, setDesignTheme] = useState<boolean>(true)
    const [copyText, setCopyText] = useState<string>('Copy URL')
    const [shareLabel, setShareLabel] = useState<string | undefined>('')
    const [hideHistoryLabel, setHideHistoryLabel] = useState<string>('Hide chat history')
    const [showHistoryLabel, setShowHistoryLabel] = useState<string>('Show chat history')
    const appStateContext = useContext(AppStateContext)
    const ui = appStateContext?.state.frontendSettings?.ui
    const appVersion: string = packageJSON.version;     
    const handleShareClick = () => {
        setIsSharePanelOpen(true)
    }

    const handleSharePanelDismiss = () => {
        setIsSharePanelOpen(false)
        setCopyClicked(false)
        setCopyText('Copy URL')
    }

    const handleCopyClick = () => {
        navigator.clipboard.writeText(window.location.href)
        setCopyClicked(true)
    }

    const handleHistoryClick = () => {
        appStateContext?.dispatch({ type: 'TOGGLE_CHAT_HISTORY' })
    }
    const handleDesignChange = () => {
        console.log(document.body.getAttribute("data-theme"))
        if (!document.body.getAttribute("data-theme")) {
            document.body.setAttribute("data-theme", "comos")
            localStorage.setItem('designTheme', "comos");
            appStateContext!.state.frontendSettings!.ui!.design_theme = "comos"
            setDesignTheme(false)
        } else {
            setDesignTheme(true)
            document.body.removeAttribute("data-theme")
            localStorage.setItem('designTheme', "");
            appStateContext!.state.frontendSettings!.ui!.design_theme = ""
        }
    }  
    
    useEffect(() => {
        if (copyClicked) {
            setCopyText('Copied URL')
        }
        const theme = localStorage.getItem('designTheme');
        if (ui?.design_theme && ui?.design_theme == "" && !theme) {
            setDesignTheme(false)
        }
        else {
            setDesignTheme(true)
        }
    }, [copyClicked])

    useEffect(() => { }, [appStateContext?.state.isCosmosDBAvailable.status])

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 480) {
                setShareLabel(undefined)
                setHideHistoryLabel('Hide history')
                setShowHistoryLabel('Show history')
            } else {
                setShareLabel('Share')
                setHideHistoryLabel('Hide chat history')
                setShowHistoryLabel('Show chat history')
            }
        }

        window.addEventListener('resize', handleResize)
        handleResize()

        return () => window.removeEventListener('resize', handleResize)
    }, [])

    return (
        <div className={styles.layout}>
            <header className={styles.header} role={'banner'}>
                <Stack horizontal verticalAlign="center" horizontalAlign="space-between">
                    <Stack horizontal verticalAlign="center">
                        <img src={ui?.logo ? ui.logo : Contoso} className={styles.headerIcon} aria-hidden="true" alt="" />
                        <Link to="/" className={styles.headerTitleContainer}>
                            <h1 className={styles.headerTitle}>{ui?.title}</h1>
                        </Link>
                    </Stack>
                    <Stack horizontal tokens={{ childrenGap: 4 }} className={styles.shareButtonContainer}>
                        {appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured && (
                            <HistoryButton
                                onClick={handleHistoryClick}
                                text={appStateContext?.state?.isChatHistoryOpen ? hideHistoryLabel : showHistoryLabel}
                            />
                        )}
                        {ui?.show_share_button && <ShareButton onClick={handleShareClick} text={shareLabel} />}
                    </Stack>
                </Stack>
            </header>
            <Outlet />
            <footer className={styles.footer}>
                <span className={styles.version}>Siemens Industry Software GmbH &#8226; 2024 &#8226; Version: {appVersion} &#8226;</span>
                <CommandBarButton onClick={handleDesignChange} className={styles.darkModeButton}
                    styles={{
                        icon: {
                            color: 'var(--bg-color-icon) !important;',
                        },
                        root: {
                            background: "transparent",
                        }
                    }}
                    title={isDarkTheme ? 'Light Theme' : 'Dark theme'}
                    iconProps={{ iconName: isDarkTheme ? 'Sunny' : 'ClearNight' }}
                />
            </footer>
            <Dialog
                onDismiss={handleSharePanelDismiss}
                hidden={!isSharePanelOpen}
                styles={{
                    main: [
                        {
                            selectors: {
                                ['@media (min-width: 480px)']: {
                                    maxWidth: '600px',
                                    background: '#FFFFFF',
                                    boxShadow: '0px 14px 28.8px rgba(0, 0, 0, 0.24), 0px 0px 8px rgba(0, 0, 0, 0.2)',
                                    borderRadius: '8px',
                                    maxHeight: '200px',
                                    minHeight: '100px'
                                }
                            }
                        }
                    ]
                }}
                dialogContentProps={{
                    title: 'Share the web app',
                    showCloseButton: true
                }}>
                <Stack horizontal verticalAlign="center" style={{ gap: '8px' }}>
                    <TextField className={styles.urlTextBox} defaultValue={window.location.href} readOnly />
                    <div
                        className={styles.copyButtonContainer}
                        role="button"
                        tabIndex={0}
                        aria-label="Copy"
                        onClick={handleCopyClick}
                        onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? handleCopyClick() : null)}>
                        <CopyRegular className={styles.copyButton} />
                        <span className={styles.copyButtonText}>{copyText}</span>
                    </div>
                </Stack>
            </Dialog>
        </div>
    )
}

export default Layout
