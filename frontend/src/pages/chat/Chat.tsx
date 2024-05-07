import { useRef, useState, useEffect, useContext, useLayoutEffect } from "react";
import { CommandBarButton, IconButton, Dialog, DialogType, Stack } from "@fluentui/react";
import { SquareRegular, ShieldLockRegular, ErrorCircleRegular } from "@fluentui/react-icons";

import ReactMarkdown from "react-markdown";
import remarkGfm from 'remark-gfm'
import rehypeRaw from "rehype-raw";
import uuid from 'react-uuid';
import { isEmpty } from "lodash";
import DOMPurify from 'dompurify';

import styles from "./Chat.module.css";
import Contoso from "../../assets/comos.png";
import Contoso_Gray from "../../assets/comos_gray.png";
import Loading from "../../assets/loading.svg";
import { XSSAllowTags } from "../../constants/xssAllowTags";

import {
    ChatMessage,
    ConversationRequest,
    conversationApi,
    uploadAttachment,
    deleteAttachment,
    getAttachment,
    Citation,
    ToolMessageContent,
    ChatResponse,
    getUserInfo,
    Conversation,
    historyGenerate,
    historyUpdate,
    historyClear,
    ChatHistoryLoadingState,
    CosmosDBStatus,
    ErrorMessage,
    ChatMessageContent,
    BlobImage
} from "../../api";
import { Answer } from "../../components/Answer";
import { QuestionInput } from "../../components/QuestionInput";
import { ChatHistoryPanel } from "../../components/ChatHistory/ChatHistoryPanel";
import { AppStateContext } from "../../state/AppProvider";
import { useBoolean } from "@fluentui/react-hooks";

const enum messageStatus {
    NotRunning = "Not Running",
    Processing = "Processing",
    Done = "Done"
}

const Chat = () => {
    const appStateContext = useContext(AppStateContext)
    const ui = appStateContext?.state.frontendSettings?.ui;
    const AUTH_ENABLED = appStateContext?.state.frontendSettings?.auth_enabled;
    const chatMessageStreamEnd = useRef<HTMLDivElement | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [showLoadingMessage, setShowLoadingMessage] = useState<boolean>(false);
    const [activeCitation, setActiveCitation] = useState<Citation>();
    const [isCitationPanelOpen, setIsCitationPanelOpen] = useState<boolean>(false);
    const abortFuncs = useRef([] as AbortController[]);
    const [showAuthMessage, setShowAuthMessage] = useState<boolean | undefined>();
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [messageAttachments, setMessageAttachments] = useState<BlobImage[]>([])
    const [processMessages, setProcessMessages] = useState<messageStatus>(messageStatus.NotRunning);
    const [clearingChat, setClearingChat] = useState<boolean>(false);
    const [hideErrorDialog, { toggle: toggleErrorDialog }] = useBoolean(true);
    const [errorMsg, setErrorMsg] = useState<ErrorMessage | null>();
    const [logo, setImage] = useState(() => {
        if(localStorage.getItem("designTheme") && localStorage.getItem("designTheme") == "")
            return Contoso;
        else
            return Contoso_Gray;
    })

    const errorDialogContentProps = {
        type: DialogType.close,
        title: errorMsg?.title,
        closeButtonAriaLabel: 'Close',
        subText: errorMsg?.subtitle,
    };

    const modalProps = {
        titleAriaId: 'labelId',
        subtitleAriaId: 'subTextId',
        isBlocking: true,
        styles: { main: { maxWidth: 450 } },
    }

    const [ASSISTANT, TOOL, ERROR] = ["assistant", "tool", "error"]
    const NO_CONTENT_ERROR = "No content in messages object."

    useEffect(() => {
        if (appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.Working
            && appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured
            && appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Fail
            && hideErrorDialog) {
            let subtitle = `${appStateContext.state.isCosmosDBAvailable.status}. Please contact the site administrator.`
            setErrorMsg({
                title: "Chat history is not enabled",
                subtitle: subtitle
            })
            toggleErrorDialog();
        }
    }, [appStateContext?.state.isCosmosDBAvailable]);

    useEffect(() => {
        function handleClick() {           
            if (localStorage.getItem('designTheme') == "") {
                setImage(Contoso)
            } else {
                setImage(Contoso_Gray)
            }
        }
        document.body.addEventListener('click', handleClick);
        return () => {
            document.body.removeEventListener('click', handleClick);
        };
    }, [document.body.getAttribute("data-theme")]);

    const handleErrorDialogClose = () => {
        toggleErrorDialog()
        setTimeout(() => {
            setErrorMsg(null)
        }, 500);
    }

    useEffect(() => {
        setIsLoading(appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Loading)
    }, [appStateContext?.state.chatHistoryLoadingState])

    const getUserInfoList = async () => {
        if (!AUTH_ENABLED) {
            setShowAuthMessage(false);
            return;
        }
        const userInfoList = await getUserInfo();
        if (userInfoList.length === 0 && window.location.hostname !== "127.0.0.1") {
            setShowAuthMessage(true);
        }
        else {
            setShowAuthMessage(false);
        }
    }

    let assistantMessage = {} as ChatMessage
    let toolMessage = {} as ChatMessage
    let assistantContent = ""

    const processResultMessage = (resultMessage: ChatMessage, userMessage: ChatMessage, conversationId?: string) => {
        if (resultMessage.role === ASSISTANT) {
            assistantContent += resultMessage.content
            assistantMessage = resultMessage
            assistantMessage.content = [{
                type: "text",
                text: assistantContent
            }]

            if (resultMessage.context) {
                toolMessage = {
                    id: uuid(),
                    role: TOOL,
                    content:
                        [{
                            type: "text",
                            text: resultMessage.context
                        }],
                    date: new Date().toISOString(),
                }
            }
        }

        if (resultMessage.role === TOOL) toolMessage = resultMessage

        if (!conversationId) {
            isEmpty(toolMessage) ?
                setMessages([...messages, userMessage, assistantMessage]) :
                setMessages([...messages, userMessage, toolMessage, assistantMessage]);
        } else {
            isEmpty(toolMessage) ?
                setMessages([...messages, assistantMessage]) :
                setMessages([...messages, toolMessage, assistantMessage]);
        }

    }
    /* useEffect(() => {
         document.querySelectorAll('pre code').forEach((block) => {
             if (!(block as HTMLElement).dataset.highlighted) {
                 // Entfernt das Attribut, wenn es bereits hervorgehoben wurde
                 hljs.highlightAll();
                 //    delete (block as HTMLElement).dataset.highlighted;
             }
             //  hljs.highlightElement(block as HTMLElement);
         });
     }, [assistantMessage]);*/
    const makeApiRequestWithoutCosmosDB = async (question: string, conversationId?: string) => {
        setIsLoading(true);
        setShowLoadingMessage(true);
        const abortController = new AbortController();
        abortFuncs.current.unshift(abortController);
        let userMessage: ChatMessage;
        if (typeof (question) == typeof (String)) {
            userMessage = {
                id: uuid(),
                role: "user",
                content: [{
                    type: "text",
                    text: question
                }],
                date: new Date().toISOString()
            };
        }
        else {

            let contentWithImages: ChatMessageContent[];
            if (!selectedFiles || !selectedFiles.sas_url) {
                contentWithImages = [
                    {
                        type: "text",
                        text: question
                    }];
            }
            else {
                contentWithImages = [
                    {
                        type: "text",
                        text: question
                    },
                    {
                        type: "image_url",
                        image_url: {
                            "url": selectedFiles?.sas_url
                        }
                    }];
            }
            userMessage = {
                id: uuid(),
                role: "user",
                content: contentWithImages!,
                date: new Date().toISOString(),
                attachmentId: selectedFiles?.file_name
            };
        }
        setSelectedFiles(undefined);

        let conversation: Conversation | null | undefined;
        if (!conversationId) {
            conversation = {
                id: conversationId ?? uuid(),
                title: question.toString(),
                messages: [userMessage],
                date: new Date().toISOString(),
            }
        } else {
            conversation = appStateContext?.state?.currentChat
            if (!conversation) {
                console.error("Conversation not found.");
                setIsLoading(false);
                setShowLoadingMessage(false);
                abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                return;
            } else {
                conversation.messages.push(userMessage);
            }
        }

        appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: conversation });
        setMessages(conversation.messages)

        const request: ConversationRequest = {
            messages: [...conversation.messages.filter((answer) => answer.role !== ERROR)]
        };
        let result = {} as ChatResponse;
        try {
            const response = await conversationApi(request, abortController.signal);
            if (response?.body) {
                console.log(response.body);
                const reader = response.body.getReader();
                let runningText = "";

                while (true) {
                    setProcessMessages(messageStatus.Processing)
                    const { done, value } = await reader.read();
                    if (done) break;

                    var text = new TextDecoder("utf-8").decode(value);
                    const objects = text.split("\n");
                    objects.forEach((obj) => {
                        try {
                            if (obj !== "" && obj !== "{}") {
                                runningText += obj;
                                result = JSON.parse(runningText);
                                if (result.choices?.length > 0) {
                                    result.choices[0].messages.forEach((msg) => {
                                        msg.id = result.id;
                                        msg.date = new Date().toISOString();
                                    })
                                    if (result.choices[0].messages?.some(m => m.role === ASSISTANT)) {
                                        setShowLoadingMessage(false);
                                    }
                                    result.choices[0].messages.forEach((resultObj) => {
                                        processResultMessage(resultObj, userMessage, conversationId);
                                    })
                                }
                                else if (result.error) {
                                    throw Error(result.error);
                                }
                                runningText = "";
                            }
                        }
                        catch (e) {
                            if (!(e instanceof SyntaxError)) {
                                console.error(e);
                                throw e;
                            } else {
                                console.log("Incomplete message. Continuing...")
                            }
                        }
                    });
                }
                conversation.messages.push(toolMessage, assistantMessage)
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: conversation });
                setMessages([...messages, toolMessage, assistantMessage]);
            }

        } catch (e) {
            if (!abortController.signal.aborted) {
                let errorMessage = "An error occurred. Please try again. If the problem persists, please contact the site administrator.";
                if (result.error?.message) {
                    errorMessage = result.error.message;
                }
                else if (typeof result.error === "string") {
                    errorMessage = result.error;
                }
                let errorChatMsg: ChatMessage = {
                    id: uuid(),
                    role: ERROR,
                    content: [{
                        type: "text",
                        text: errorMessage
                    }],
                    date: new Date().toISOString()
                }
                conversation.messages.push(errorChatMsg);
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: conversation });
                setMessages([...messages, errorChatMsg]);
            } else {
                setMessages([...messages, userMessage])
                const images: BlobImage[] = [];
                messages.forEach(message => {
                    if (message.attachmentId) {
                        const blobStorage = getAttachment(message.attachmentId).then((res) => {
                            images.push(res);
                            setMessageAttachments(images)
                        });
                    }
                });
            }
        } finally {
            setIsLoading(false);
            setShowLoadingMessage(false);
            setSelectedFiles(undefined);
            abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
            setProcessMessages(messageStatus.Done)
        }

        return abortController.abort();
    };

    const makeApiRequestWithCosmosDB = async (question: string, conversationId?: string) => {
        setIsLoading(true);
        setShowLoadingMessage(true);
        const abortController = new AbortController();
        abortFuncs.current.unshift(abortController);
        let userMessage: ChatMessage;
        if (typeof (question) == typeof (String)) {
            userMessage = {
                id: uuid(),
                role: "user",
                content: [{
                    type: "text",
                    text: question
                }],
                date: new Date().toISOString()
            };
        }
        else {

            let contentWithImages: ChatMessageContent[];
            if (!selectedFiles || !selectedFiles.sas_url) {
                contentWithImages = [
                    {
                        type: "text",
                        text: question
                    }];
            }
            else {
                contentWithImages = [
                    {
                        type: "text",
                        text: question
                    },
                    {
                        type: "image_url",
                        image_url: {
                            "url": selectedFiles?.sas_url
                        }
                    }];
            }
            userMessage = {
                id: uuid(),
                role: "user",
                content: contentWithImages,
                date: new Date().toISOString(),
                attachmentId: selectedFiles?.file_name
            };
        }
        setSelectedFiles(undefined);
        //api call params set here (generate)
        let request: ConversationRequest;
        let conversation;
        if (conversationId) {
            conversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
            if (!conversation) {
                console.error("Conversation not found.");
                setIsLoading(false);
                setShowLoadingMessage(false);
                abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                return;
            } else {
                conversation.messages.push(userMessage);
                request = {
                    messages: [...conversation.messages.filter((answer) => answer.role !== ERROR)]
                };
            }
        } else {
            request = {
                messages: [userMessage].filter((answer) => answer.role !== ERROR)
            };
            setMessages(request.messages)
        }
        let result = {} as ChatResponse;
        try {
            const response = conversationId ? await historyGenerate(request, abortController.signal, conversationId) : await historyGenerate(request, abortController.signal);
            if (!response?.ok) {
                const responseJson = await response.json();
                var errorResponseMessage = responseJson.error === undefined ? "Please try again. If the problem persists, please contact the site administrator." : responseJson.error;
                let errorChatMsg: ChatMessage = {
                    id: uuid(),
                    role: ERROR,
                    content: [{
                        type: "text",
                        text: `There was an error generating a response. Chat history can't be saved at this time. ${errorResponseMessage}`,
                    }],
                    date: new Date().toISOString()
                }
                let resultConversation;
                if (conversationId) {
                    resultConversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
                    if (!resultConversation) {
                        console.error("Conversation not found.");
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    resultConversation.messages.push(errorChatMsg);
                } else {
                    setMessages([...messages, userMessage, errorChatMsg])
                    setIsLoading(false);
                    setShowLoadingMessage(false);
                    abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                    return;
                }
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: resultConversation });
                setMessages([...resultConversation.messages]);
                const images: BlobImage[] = [];
                messages.forEach(message => {
                    if (message.attachmentId) {
                        const blobStorage = getAttachment(message.attachmentId).then((res) => {
                            images.push(res);
                            setMessageAttachments(images)
                        });
                    }
                });
                return;
            }
            if (response?.body) {
                const reader = response.body.getReader();
                let runningText = "";

                while (true) {
                    setProcessMessages(messageStatus.Processing)
                    const { done, value } = await reader.read();
                    if (done) break;

                    var text = new TextDecoder("utf-8").decode(value);
                    const objects = text.split("\n");
                    objects.forEach((obj) => {
                        try {
                            if (obj !== "" && obj !== "{}") {
                                runningText += obj;
                                result = JSON.parse(runningText);
                                if (!result.choices?.[0]?.messages?.[0].content) {
                                    errorResponseMessage = NO_CONTENT_ERROR;
                                    throw Error();
                                }
                                if (result.choices?.length > 0) {
                                    result.choices[0].messages.forEach((msg) => {
                                        msg.id = result.id;
                                        msg.date = new Date().toISOString();
                                    })
                                    if (result.choices[0].messages?.some(m => m.role === ASSISTANT)) {
                                        setShowLoadingMessage(false);
                                    }
                                    result.choices[0].messages.forEach((resultObj) => {
                                        processResultMessage(resultObj, userMessage, conversationId);
                                    })
                                }
                                runningText = "";
                            }
                            else if (result.error) {
                                throw Error(result.error);
                            }
                        }
                        catch (e) {
                            if (!(e instanceof SyntaxError)) {
                                console.error(e);
                                throw e;
                            } else {
                                console.log("Incomplete message. Continuing...")
                            }
                        }
                    });
                }

                let resultConversation;
                if (conversationId) {
                    resultConversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
                    if (!resultConversation) {
                        console.error("Conversation not found.");
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    isEmpty(toolMessage) ?
                        resultConversation.messages.push(assistantMessage) :
                        resultConversation.messages.push(toolMessage, assistantMessage)
                } else {
                    resultConversation = {
                        id: result.history_metadata.conversation_id,
                        title: result.history_metadata.title,
                        messages: [userMessage],
                        date: result.history_metadata.date
                    }
                    isEmpty(toolMessage) ?
                        resultConversation.messages.push(assistantMessage) :
                        resultConversation.messages.push(toolMessage, assistantMessage)
                }
                if (!resultConversation) {
                    setIsLoading(false);
                    setShowLoadingMessage(false);
                    abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                    return;
                }
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: resultConversation });
                isEmpty(toolMessage) ?
                    setMessages([...messages, assistantMessage]) :
                    setMessages([...messages, toolMessage, assistantMessage]);
            }

        } catch (e) {
            if (!abortController.signal.aborted) {
                let errorMessage = `An error occurred. ${errorResponseMessage}`;
                if (result.error?.message) {
                    errorMessage = result.error.message;
                }
                else if (typeof result.error === "string") {
                    errorMessage = result.error;
                }
                let errorChatMsg: ChatMessage = {
                    id: uuid(),
                    role: ERROR,
                    content: [{
                        type: "text",
                        text: errorMessage
                    }],
                    date: new Date().toISOString()
                }
                let resultConversation;
                if (conversationId) {
                    resultConversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
                    if (!resultConversation) {
                        console.error("Conversation not found.");
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    resultConversation.messages.push(errorChatMsg);
                } else {
                    if (!result.history_metadata) {
                        console.error("Error retrieving data.", result);
                        let errorChatMsg: ChatMessage = {
                            id: uuid(),
                            role: ERROR,
                            content: [{
                                type: "text",
                                text: errorMessage
                            }],
                            date: new Date().toISOString()
                        }
                        setMessages([...messages, userMessage, errorChatMsg])
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    resultConversation = {
                        id: result.history_metadata.conversation_id,
                        title: result.history_metadata.title,
                        messages: [userMessage],
                        date: result.history_metadata.date
                    }
                    resultConversation.messages.push(errorChatMsg);
                }
                if (!resultConversation) {
                    setIsLoading(false);
                    setShowLoadingMessage(false);
                    abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                    return;
                }
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: resultConversation });
                setMessages([...messages, errorChatMsg]);
            } else {
                setMessages([...messages, userMessage])
            }
        } finally {
            setIsLoading(false);
            setSelectedFiles(undefined);
            setShowLoadingMessage(false);
            abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
            setProcessMessages(messageStatus.Done)
        }
        return abortController.abort();

    }

    const clearChat = async () => {
        setClearingChat(true)
        if (appStateContext?.state.currentChat?.id && appStateContext?.state.isCosmosDBAvailable.cosmosDB) {
            let response = await historyClear(appStateContext?.state.currentChat.id)
            if (!response.ok) {
                setErrorMsg({
                    title: "Error clearing current chat",
                    subtitle: "Please try again. If the problem persists, please contact the site administrator.",
                })
                toggleErrorDialog();
            } else {
                appStateContext?.dispatch({ type: 'DELETE_CURRENT_CHAT_MESSAGES', payload: appStateContext?.state.currentChat.id });
                appStateContext?.dispatch({ type: 'UPDATE_CHAT_HISTORY', payload: appStateContext?.state.currentChat });
                setActiveCitation(undefined);
                setIsCitationPanelOpen(false);
                setMessages([])
            }
        }
        setSelectedFiles(undefined);
        setClearingChat(false)
    };
    const inputFile = useRef<HTMLInputElement | null>(null);
    const uploadImage = () => {
        inputFile.current!.click();
    };
    const [selectedFiles, setSelectedFiles] = useState<BlobImage>();
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (appStateContext?.state.frontendSettings?.image_upload_enabled) {
            if (event.target.files) {
                const file = event.target.files[0]
                let blobImage: BlobImage = {
                    file: file
                }
                //setSelectedFiles(blobImage);
                /* const reader = new FileReader();
                 const file = event.target.files[0];
                 reader.onloadend = () => {
                     const base64data = reader.result as string;
                     const mimeType = file.type || 'application/octet-stream';
                     setImageUrl(`data:${mimeType};base64,${base64data.split(',')[1]}`)
                 };
                 reader.readAsDataURL(file);*/
                const img: BlobImage = await uploadAttachment(blobImage)
                    .then((res) => {
                        return res;
                    })
                    .catch((error) => {
                        console.log(error);
                        return {};
                    });
                if (img && img.sas_url) {
                    console.log(img);
                    setSelectedFiles(img);
                    messageAttachments.push(img)
                    setMessageAttachments(messageAttachments)
                }
            }
        }
    };

    const newChat = () => {
        setSelectedFiles(undefined);
        setProcessMessages(messageStatus.Processing)
        setMessages([])
        setIsCitationPanelOpen(false);
        setActiveCitation(undefined);
        appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: null });
        setProcessMessages(messageStatus.Done)
    };

    const stopGenerating = () => {
        abortFuncs.current.forEach(a => a.abort());
        setShowLoadingMessage(false);
        setIsLoading(false);
    }

    useEffect(() => {
        if (appStateContext?.state.currentChat) {
            setMessages(appStateContext.state.currentChat.messages)
        } else {
            setMessages([])
        }
    }, [appStateContext?.state.currentChat]);

    useLayoutEffect(() => {
        const saveToDB = async (messages: ChatMessage[], id: string) => {
            const response = await historyUpdate(messages, id)
            return response
        }

        if (appStateContext && appStateContext.state.currentChat && processMessages === messageStatus.Done) {
            if (appStateContext.state.isCosmosDBAvailable.cosmosDB) {
                if (!appStateContext?.state.currentChat?.messages) {
                    console.error("Failure fetching current chat state.")
                    return
                }
                const noContentError = appStateContext.state.currentChat.messages.find(m => m.role === ERROR)

                if (!noContentError?.content[0].text?.includes(NO_CONTENT_ERROR)) {
                    saveToDB(appStateContext.state.currentChat.messages, appStateContext.state.currentChat.id)
                        .then((res) => {
                            if (!res.ok) {
                                let errorMessage = "An error occurred. Answers can't be saved at this time. If the problem persists, please contact the site administrator.";
                                let errorChatMsg: ChatMessage = {
                                    id: uuid(),
                                    role: ERROR,
                                    content: [{
                                        type: "text",
                                        text: errorMessage
                                    }],
                                    date: new Date().toISOString()
                                }
                                if (!appStateContext?.state.currentChat?.messages) {
                                    let err: Error = {
                                        ...new Error,
                                        message: "Failure fetching current chat state."
                                    }
                                    throw err
                                }
                                setMessages([...appStateContext?.state.currentChat?.messages, errorChatMsg])
                            }
                            return res as Response
                        })
                        .catch((err) => {
                            console.error("Error: ", err)
                            let errRes: Response = {
                                ...new Response,
                                ok: false,
                                status: 500,
                            }
                            return errRes;
                        })
                }
            } else {
            }
            appStateContext?.dispatch({ type: 'UPDATE_CHAT_HISTORY', payload: appStateContext.state.currentChat });
            setMessages(appStateContext.state.currentChat.messages)
            setProcessMessages(messageStatus.NotRunning)
        }
    }, [processMessages]);

    useEffect(() => {
        if (AUTH_ENABLED !== undefined) getUserInfoList();
    }, [AUTH_ENABLED]);

    useLayoutEffect(() => {
        chatMessageStreamEnd.current?.scrollIntoView({ behavior: "smooth" })
    }, [showLoadingMessage, processMessages]);

    const onShowCitation = (citation: Citation) => {
        setActiveCitation(citation);
        setIsCitationPanelOpen(true);
    };

    const onViewSource = (citation: Citation) => {
        if (citation.url && !citation.url.includes("blob.core")) {
            window.open(citation.url, "_blank");
        }
    };

    const handlePaste = async (event: any) => {
        // Überprüfen, ob ein Bild im Clipboard ist
        if (appStateContext?.state.frontendSettings?.image_upload_enabled) {
            console.log("handlePaste")
            if (event.clipboardData.files) {
                const file = event.clipboardData.files[0]
                let blobImage: BlobImage = {
                    file: file
                }
                const img: BlobImage = await uploadAttachment(blobImage)
                    .then((res) => {
                        return res;
                    })
                    .catch((error) => {
                        console.log(error);
                        return {};
                    });
                if (img && img.sas_url) {
                    console.log(img);
                    setSelectedFiles(img);
                    messageAttachments.push(img)
                    setMessageAttachments(messageAttachments)
                }
            }
        }
    };

    const deleteImages = async () => {
        //Todo id herausfinden       
        if (appStateContext?.state.frontendSettings?.image_upload_enabled) {
            const deletionStatus = await deleteAttachment(selectedFiles?.file_name!);
            if (deletionStatus) {
                setSelectedFiles(undefined);
            }
            else {
                alert("Something went wrong with image deletion..")
            }
        }
    }

    const parseCitationFromMessage = (message: ChatMessage) => {
        if (message?.role && message?.role === "tool") {
            try {
                const toolMessage = JSON.parse(message.content.toString()) as ToolMessageContent;
                return toolMessage.citations;
            }
            catch {
                return [];
            }
        }
        return [];
    }

    const disabledButton = () => {
        return isLoading || (messages && messages.length === 0) || clearingChat || appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Loading
    }
    return (
        <div className={styles.container} role="main">
            {showAuthMessage ? (
                <Stack className={styles.chatEmptyState}>
                    <ShieldLockRegular className={styles.chatIcon} style={{ color: 'darkorange', height: "200px", width: "200px" }} />
                    <h1 className={styles.chatEmptyStateTitle}>Authentication Not Configured</h1>
                    <h2 className={styles.chatEmptyStateSubtitle}>
                        This app does not have authentication configured. Please add an identity provider by finding your app in the <a href="https://portal.azure.com/" target="_blank">Azure Portal</a>
                        and following <a href="https://learn.microsoft.com/en-us/azure/app-service/scenario-secure-app-authentication-app-service#3-configure-authentication-and-authorization" target="_blank">these instructions</a>.
                    </h2>
                    <h2 className={styles.chatEmptyStateSubtitle} style={{ fontSize: "20px" }}><strong>Authentication configuration takes a few minutes to apply. </strong></h2>
                    <h2 className={styles.chatEmptyStateSubtitle} style={{ fontSize: "20px" }}><strong>If you deployed in the last 10 minutes, please wait and reload the page after 10 minutes.</strong></h2>
                </Stack>
            ) : (
                <Stack horizontal className={styles.chatRoot}>
                    <div className={styles.chatContainer} onPaste={handlePaste}>
                        {!messages || messages.length < 1 ? (
                            <Stack className={styles.chatEmptyState}>
                                 <img
                                    src={ui?.chat_logo ? ui.chat_logo : logo}
                                    className={styles.chatIcon}
                                    aria-hidden="true"
                                />
                                <h1 className={styles.chatEmptyStateTitle}>{ui?.chat_title}</h1>
                                <h2 className={styles.chatEmptyStateSubtitle}>{ui?.chat_description}</h2>
                            </Stack>
                        ) : (
                            <div className={styles.chatMessageStream} style={{ marginBottom: isLoading ? "40px" : "0px" }} role="log">
                                {messages.map((answer, index) => (
                                    <>
                                        {answer.role === "user" ? (
                                            <div className={styles.chatMessageUser} tabIndex={0}>
                                                <div className={styles.chatMessageUserMessage}>
                                                    <div className={styles.chatImageUserMessage}>
                                                        {answer.attachmentId !== "" && (answer.content as ChatMessageContent[]).length > 1 && (answer.content as ChatMessageContent[])[1]?.image_url?.url ? (
                                                            <img className={styles.imageContainer} src={(answer.content as ChatMessageContent[])[1].image_url?.url} /> //messageAttachments.find(x => x.file_id === answer.attachmentId)?.sas_url} />
                                                        )
                                                            :
                                                            <div style={{ display: 'none' }}></div>
                                                        }
                                                    </div>
                                                    <div>
                                                        {(answer.content as ChatMessageContent[])[0].text}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            answer.role === "assistant" ? <div className={styles.chatMessageGpt}>
                                                <Answer
                                                    answer={{
                                                        answer: answer.content[0],
                                                        citations: parseCitationFromMessage(messages[index - 1]),
                                                        message_id: answer.id,
                                                        feedback: answer.feedback
                                                    }}
                                                    onCitationClicked={c => onShowCitation(c)}
                                                />
                                            </div> : answer.role === ERROR ? <div className={styles.chatMessageError}>
                                                <Stack horizontal className={styles.chatMessageErrorContent}>
                                                    <ErrorCircleRegular className={styles.errorIcon} style={{ color: "rgba(182, 52, 67, 1)" }} />
                                                    <span>Error</span>
                                                </Stack>
                                                <span className={styles.chatMessageErrorContent}>{answer.content[0].text!.toString()}</span>
                                            </div> : null
                                        )}
                                    </>
                                ))}
                                {showLoadingMessage && (
                                    <>
                                        <div className={styles.chatMessageGpt}>
                                            <Answer
                                                answer={{
                                                    answer: { type: "text", "text": "Generating answer..." },
                                                    citations: []
                                                }}
                                                onCitationClicked={() => null}
                                            />
                                        </div>
                                    </>
                                )}
                                <div ref={chatMessageStreamEnd} />
                            </div>
                        )}

                        <Stack horizontal className={styles.chatInput}>
                            {isLoading && (
                                <Stack
                                    horizontal
                                    className={styles.stopGeneratingContainer}
                                    role="button"
                                    aria-label="Stop generating"
                                    tabIndex={0}
                                    onClick={stopGenerating}
                                    onKeyDown={e => e.key === "Enter" || e.key === " " ? stopGenerating() : null}
                                >
                                    <SquareRegular className={styles.stopGeneratingIcon} aria-hidden="true" />
                                    <span className={styles.stopGeneratingText} aria-hidden="true">Stop generating</span>
                                </Stack>
                            )}
                            {selectedFiles && (
                                <Stack
                                    horizontal
                                    className={styles.stopGeneratingContainer}
                                    tabIndex={0}
                                >
                                    <img className={styles.imageIcon} aria-hidden="true" src={selectedFiles.sas_url} />
                                    <span className={styles.stopGeneratingText} aria-hidden="true">Image</span>
                                </Stack>
                            )}
                            <Stack>
                                {appStateContext?.state.frontendSettings?.image_upload_enabled == true &&
                                    <Stack>
                                        {appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured && <CommandBarButton
                                            role="button"
                                            styles={{
                                                icon: {
                                                    color: '#F3F3F0',
                                                },
                                                iconDisabled: {
                                                    color: "#BDBDBD !important"
                                                },
                                                root: {
                                                    color: '#FFFFFF',
                                                    background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #00E6DC 33.63%, #00BEDC 70.31%, #00FFB9 100%)",
                                                },
                                                rootDisabled: {
                                                    background: "#F0F0F0"
                                                }
                                            }}
                                            title="Start a new chat"
                                            className={styles.newChatIcon}
                                            iconProps={{ iconName: 'Add' }}
                                            onClick={newChat}
                                            disabled={disabledButton()}
                                            aria-label="start a new chat button"
                                        />}
                                        <CommandBarButton
                                            role="button"
                                            styles={{
                                                icon: {
                                                    color: '#F3F3F0',
                                                },
                                                iconDisabled: {
                                                    color: "#BDBDBD !important",
                                                },
                                                root: {
                                                    color: '#FFFFFF',
                                                    background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #00E6DC 33.63%, #00BEDC 70.31%, #00FFB9 100%)",
                                                },
                                                rootDisabled: {
                                                    background: "#F0F0F0"
                                                }
                                            }}
                                            title="Clear chat"
                                            className={appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured ? styles.clearChatBroom : styles.clearChatBroomNoCosmos}
                                            iconProps={{ iconName: 'Broom' }}
                                            onClick={appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured ? clearChat : newChat}
                                            disabled={disabledButton()}
                                            aria-label="clear chat button"
                                        />
                                        {appStateContext?.state.frontendSettings?.image_upload_enabled === true && < CommandBarButton
                                            role="button"
                                            styles={{
                                                icon: {
                                                    color: '#F3F3F0',
                                                },
                                                iconDisabled: {
                                                    color: "#BDBDBD !important",
                                                },
                                                root: {
                                                    color: '#FFFFFF',
                                                    background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #00E6DC 33.63%, #00BEDC 70.31%, #00FFB9 100%)",
                                                },
                                                rootDisabled: {
                                                    background: "#F0F0F0"
                                                }
                                            }}
                                            title={selectedFiles === undefined ? "Upload Image" : "Remove Image"}
                                            className={styles.uploadImageIcon}
                                            iconProps={{ iconName: selectedFiles === undefined ? 'ImageSearch' : 'Delete' }}
                                            aria-label="Upload Image"
                                            disabled={isLoading}
                                            onClick={selectedFiles === undefined ? uploadImage : deleteImages}
                                        />}

                                        <input type='file' id='file' ref={inputFile} accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />

                                        <Dialog
                                            hidden={hideErrorDialog}
                                            onDismiss={handleErrorDialogClose}
                                            dialogContentProps={errorDialogContentProps}
                                            modalProps={modalProps}
                                        >
                                        </Dialog>
                                    </Stack>
                                }
                            </Stack>
                            <Stack>
                                {appStateContext?.state.frontendSettings?.image_upload_enabled == false &&
                                    <Stack>
                                        {appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured && <CommandBarButton
                                            role="button"
                                            styles={{
                                                icon: {
                                                    color: '#F3F3F0',
                                                },
                                                iconDisabled: {
                                                    color: "#BDBDBD !important"
                                                },
                                                root: {
                                                    color: '#FFFFFF',
                                                    background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #00E6DC 33.63%, #00BEDC 70.31%, #00FFB9 100%)",
                                                },
                                                rootDisabled: {
                                                    background: "#F0F0F0"
                                                }
                                            }}
                                            title="Start a new chat"
                                            className={styles.newChatIconWithOutImage}
                                            iconProps={{ iconName: 'Add' }}
                                            onClick={newChat}
                                            disabled={disabledButton()}
                                            aria-label="start a new chat button"
                                        />}
                                        <CommandBarButton
                                            role="button"
                                            styles={{
                                                icon: {
                                                    color: '#F3F3F0',
                                                },
                                                iconDisabled: {
                                                    color: "#BDBDBD !important",
                                                },
                                                root: {
                                                    color: '#FFFFFF',
                                                    background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #00E6DC 33.63%, #00BEDC 70.31%, #00FFB9 100%)",
                                                },
                                                rootDisabled: {
                                                    background: "#F0F0F0"
                                                }
                                            }}
                                            title="Clear chat"
                                            className={appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured ? styles.clearChatBroomWithOutImage : styles.clearChatBroomNoCosmosWithOutImage}
                                            iconProps={{ iconName: 'Broom' }}
                                            onClick={appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured ? clearChat : newChat}
                                            disabled={disabledButton()}
                                            aria-label="clear chat button"
                                        />
                                        <Dialog
                                            hidden={hideErrorDialog}
                                            onDismiss={handleErrorDialogClose}
                                            dialogContentProps={errorDialogContentProps}
                                            modalProps={modalProps}
                                        >
                                        </Dialog>
                                    </Stack>
                                }
                            </Stack>
                            <QuestionInput
                                clearOnSend
                                placeholder="Type a new question..."
                                disabled={isLoading}
                                onSend={(question, id) => {
                                    appStateContext?.state.isCosmosDBAvailable?.cosmosDB ? makeApiRequestWithCosmosDB(question, id) : makeApiRequestWithoutCosmosDB(question, id)
                                }}
                                conversationId={appStateContext?.state.currentChat?.id ? appStateContext?.state.currentChat?.id : undefined}
                            />
                        </Stack>
                    </div>
                    {/* Citation Panel */}
                    {messages && messages.length > 0 && isCitationPanelOpen && activeCitation && (
                        <Stack.Item className={styles.citationPanel} tabIndex={0} role="tabpanel" aria-label="Citations Panel">
                            <Stack aria-label="Citations Panel Header Container" horizontal className={styles.citationPanelHeaderContainer} horizontalAlign="space-between" verticalAlign="center">
                                <span aria-label="Citations" className={styles.citationPanelHeader}>Citations</span>
                                <IconButton iconProps={{ iconName: 'Cancel' }} aria-label="Close citations panel" onClick={() => setIsCitationPanelOpen(false)} />
                            </Stack>
                            <h5 className={styles.citationPanelTitle} tabIndex={0} title={activeCitation.url && !activeCitation.url.includes("blob.core") ? activeCitation.url : activeCitation.title ?? ""} onClick={() => onViewSource(activeCitation)}>{activeCitation.title}</h5>
                            <div tabIndex={0}>
                                <ReactMarkdown
                                    linkTarget="_blank"
                                    className={styles.citationPanelContent}
                                    children={DOMPurify.sanitize(activeCitation.content, { ALLOWED_TAGS: XSSAllowTags })}
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeRaw]}
                                />
                            </div>
                        </Stack.Item>
                    )}
                    {(appStateContext?.state.isChatHistoryOpen && appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured) && <ChatHistoryPanel />}
                </Stack>
            )}
        </div>
    );
};

export default Chat;
