import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

// =========================
// ENTERPRISE AI COPILOT LOGO
// =========================

const CopilotLogo = ({ size = 52 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 80 80"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      display: "block",
      background: "transparent",
    }}
  >
    <defs>
      <linearGradient
        id="copilot-gradient"
        x1="12"
        y1="10"
        x2="68"
        y2="70"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="#1683FF" />
        <stop offset="55%" stopColor="#315CF5" />
        <stop offset="100%" stopColor="#8B3DFF" />
      </linearGradient>
    </defs>

    {/* C */}
    <path
      d="
        M61 18
        C53 10 43 7 32 9
        C17 12 7 25 7 40
        C7 56 18 69 33 71
        C44 72 54 68 61 60
      "
      stroke="url(#copilot-gradient)"
      strokeWidth="10"
      strokeLinecap="round"
    />

    {/* AI circuit lines */}
    <path
      d="
        M29 30
        H43
        L52 21
        H63
      "
      stroke="url(#copilot-gradient)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    <path
      d="M29 40 H64"
      stroke="url(#copilot-gradient)"
      strokeWidth="4"
      strokeLinecap="round"
    />

    <path
      d="
        M29 50
        H43
        L52 59
        H63
      "
      stroke="url(#copilot-gradient)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* AI nodes */}
    <circle cx="65" cy="21" r="4" fill="#1683FF" />
    <circle cx="66" cy="40" r="4" fill="#4F67E8" />
    <circle cx="65" cy="59" r="4" fill="#8B3DFF" />
    <circle cx="29" cy="40" r="3.5" fill="#1683FF" />
  </svg>
);
function App() {
  const textareaRef = useRef(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const [conversationId, setConversationId] =
    useState(null);

  // All conversations for sidebar
  const [conversations, setConversations] =
    useState([]);

  // Conversation menu
  const [openMenuId, setOpenMenuId] =
    useState(null);

  // Selected-text follow-up
  const [selectedText, setSelectedText] =
    useState("");

  const [selectedMessageId, setSelectedMessageId] =
    useState(null);

  const [showSelectionAction, setShowSelectionAction] =
    useState(false);


  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null);
      setShowAttachmentMenu(false);
    };

    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  // =========================
  // AUTO RESIZE TEXTAREA
  // =========================
  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    const styles = window.getComputedStyle(textarea);

    const lineHeight = parseFloat(styles.lineHeight);
    const paddingTop = parseFloat(styles.paddingTop);
    const paddingBottom = parseFloat(styles.paddingBottom);

    const oneLineHeight =
      lineHeight + paddingTop + paddingBottom;

    // Reset before measuring
    textarea.style.height = `${oneLineHeight}px`;

    // Empty input
    if (!question) {
      return;
    }

    // Measure actual content
    const contentHeight = textarea.scrollHeight;

    // Expand only when content needs more than one line
    if (contentHeight > oneLineHeight + 1) {
      textarea.style.height =
        `${Math.min(contentHeight, 200)}px`;
    }
  }, [question]);

  const uploadDocuments = async () => {
    if (selectedFiles.length === 0) return;

    setUploadingFiles(true);

    try {
      const formData = new FormData();

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(
        "http://127.0.0.1:8000/documents/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(
          data.error || "Document upload failed."
        );
      }

      console.log(
        "Uploaded documents:",
        data.documents
      );

      if (data.skipped?.length > 0) {
        alert(
          `Already uploaded:\n${data.skipped.join("\n")}`
        );
      }

      setSelectedFiles([]);

    } catch (error) {
      console.error(
        "Document upload failed:",
        error
      );

      alert(error.message);

    } finally {
      setUploadingFiles(false);
    }
  };
  // =========================
  // INITIAL LOAD
  // =========================

  useEffect(() => {
    loadInitialConversation();
  }, []);


  // =========================
  // ESCAPE SELECTION MODE
  // =========================

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setSelectedText("");
        setSelectedMessageId(null);
        setShowSelectionAction(false);

        window.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);


  // =========================
  // LOAD ALL CONVERSATIONS
  // =========================
  const loadConversations = async () => {
    try {
      const response = await fetch(
        "http://127.0.0.1:8000/conversations"
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load conversations"
        );
      }

      const data = await response.json();

      setConversations(data);

      return data;
    } catch (error) {
      console.error(
        "Failed to load conversations:",
        error
      );

      return [];
    }
  };


  // =========================
  // INITIAL CONVERSATION
  // =========================

  const loadInitialConversation = async () => {
    try {
      const data = await loadConversations();

      // Check which conversation was open before refresh.
      const savedConversationId =
        localStorage.getItem("currentConversationId");

      if (savedConversationId) {
        const savedId = Number(savedConversationId);

        // If the saved chat is in Recent, reopen it.
        const existsInRecent = data.some(
          (conversation) =>
            conversation.id === savedId
        );

        if (existsInRecent) {
          await loadConversation(savedId);
          return;
        }

        /*
         * The saved conversation may be a fresh,
         * empty "New Chat". Empty conversations are
         * intentionally hidden from Recent.
         *
         * Check whether it still exists directly.
         */
        const response = await fetch(
          `http://127.0.0.1:8000/conversations/${savedId}`
        );

        if (response.ok) {
          await loadConversation(savedId);
          return;
        }

        // It was actually deleted.
        localStorage.removeItem(
          "currentConversationId"
        );
      }

      // No saved conversation:
      // keep the old behavior.
      if (data.length > 0) {
        await loadConversation(data[0].id);
      } else {
        await createConversation();
      }

    } catch (error) {
      console.error(
        "Failed to initialize conversation:",
        error
      );
    }
  };

  // =========================
  // CREATE NEW CHAT
  // =========================

  const createConversation = async () => {
    if (isGenerating) return;

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/conversations",
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to create conversation"
        );
      }

      const data =
        await response.json();

      // Switch to new conversation
      setConversationId(data.id);

      // Remember this chat so refresh keeps it open.
      localStorage.setItem(
        "currentConversationId",
        String(data.id)
      );

      setMessages([]);

      setQuestion("");

      setSelectedText("");
      setSelectedMessageId(null);
      setShowSelectionAction(false);

      setOpenMenuId(null);

      // Refresh sidebar
      await loadConversations();

    } catch (error) {
      console.error(
        "Failed to create conversation:",
        error
      );
    }
  };


  // =========================
  // LOAD CONVERSATION
  // =========================

  const loadConversation = async (id) => {
    if (isGenerating) return;

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/conversations/${id}`
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load conversation"
        );
      }

      const data =
        await response.json();

      const formattedMessages =
        data.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,

          parentMessageId:
            message.parent_message_id ??
            message.parentMessageId ??
            null,

          version:
            message.version ?? 1,

          selectedText:
            message.selected_text ??
            message.selectedText ??
            null,

          selectedMessageId:
            message.selected_message_id ??
            message.selectedMessageId ??
            null,
        }));

      setMessages(
        formattedMessages
      );

      setConversationId(id);

      // Remember the currently open chat.
      localStorage.setItem(
        "currentConversationId",
        String(id)
      );

      setQuestion("");

      setSelectedText("");
      setSelectedMessageId(null);
      setShowSelectionAction(false);

      setOpenMenuId(null);

    } catch (error) {
      console.error(
        "Failed to load conversation:",
        error
      );
    }
  };


  // =========================
  // DELETE CONVERSATION
  // =========================

  const deleteConversation = async (id) => {
    if (isGenerating) return;

    const confirmed = window.confirm(
      "Delete this conversation?"
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/conversations/${id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to delete conversation"
        );
      }

      // Get remaining conversations
      const remaining =
        await loadConversations();

      setOpenMenuId(null);

      // If deleting current chat
      if (id === conversationId) {

        if (remaining.length > 0) {

          // Open newest remaining chat
          await loadConversation(
            remaining[0].id
          );

        } else {

          // No conversations left
          await createConversation();
        }
      }

    } catch (error) {
      console.error(
        "Failed to delete conversation:",
        error
      );
    }
  };


  // =========================
  // TEXT SELECTION
  // =========================

  const handleTextSelection = () => {
    if (isGenerating) return;

    const selection =
      window.getSelection();

    const text =
      selection?.toString().trim();

    if (!text) return;

    const anchorNode =
      selection.anchorNode;

    if (!anchorNode) return;

    const assistantMessage =
      anchorNode.parentElement?.closest(
        ".message.assistant"
      );

    if (!assistantMessage) return;

    const messageId =
      assistantMessage.dataset.messageId;

    if (!messageId) return;

    setSelectedText(text);

    setSelectedMessageId(
      Number(messageId)
    );

    setShowSelectionAction(true);
  };


  // =========================
  // ACTIVATE FOLLOW-UP
  // =========================

  const askAboutSelection = () => {
    if (
      !selectedText ||
      !selectedMessageId ||
      isGenerating
    ) {
      return;
    }

    setShowSelectionAction(false);

    setTimeout(() => {
      document
        .querySelector(".chat-input")
        ?.focus();
    }, 50);
  };


  // =========================
  // REMOVE SELECTION
  // =========================

  const removeSelectedText = () => {
    setSelectedText("");
    setSelectedMessageId(null);
    setShowSelectionAction(false);

    window
      .getSelection()
      ?.removeAllRanges();
  };


  // =========================
  // FIND TEXT RANGE
  // =========================

  const findTextRange = (
    container,
    searchText
  ) => {
    const walker =
      document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT
      );

    const textNodes = [];

    let fullText = "";

    let node;

    while (
      (node = walker.nextNode())
    ) {
      textNodes.push({
        node,
        start: fullText.length,
      });

      fullText += node.textContent;
    }

    const startIndex =
      fullText.indexOf(
        searchText
      );

    if (startIndex === -1) {
      return null;
    }

    const endIndex =
      startIndex +
      searchText.length;

    let startNode = null;
    let startOffset = 0;

    let endNode = null;
    let endOffset = 0;

    for (const item of textNodes) {

      const nodeStart =
        item.start;

      const nodeEnd =
        nodeStart +
        item.node.textContent.length;

      if (
        startNode === null &&
        startIndex >= nodeStart &&
        startIndex <= nodeEnd
      ) {
        startNode = item.node;

        startOffset =
          startIndex -
          nodeStart;
      }

      if (
        endIndex >= nodeStart &&
        endIndex <= nodeEnd
      ) {
        endNode = item.node;

        endOffset =
          endIndex -
          nodeStart;

        break;
      }
    }

    if (
      !startNode ||
      !endNode
    ) {
      return null;
    }

    const range =
      document.createRange();

    range.setStart(
      startNode,
      startOffset
    );

    range.setEnd(
      endNode,
      endOffset
    );

    return range;
  };


  // =========================
  // JUMP TO REFERENCE
  // =========================

  const scrollToReference = (
    messageId,
    text
  ) => {
    if (
      !messageId ||
      !text
    ) {
      return;
    }

    const messageElement =
      document.querySelector(
        `.message[data-message-id="${messageId}"]`
      );

    if (!messageElement) return;

    const content =
      messageElement.querySelector(
        ".message-content"
      );

    if (!content) return;

    const range =
      findTextRange(
        content,
        text
      );

    if (!range) {

      messageElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      return;
    }

    messageElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    setTimeout(() => {

      const selection =
        window.getSelection();

      selection.removeAllRanges();

      selection.addRange(range);

    }, 300);
  };


  // =========================
  // REFRESH MESSAGES
  // =========================

  const refreshConversation =
    async () => {

      if (!conversationId) return;

      try {
        const response =
          await fetch(
            `http://127.0.0.1:8000/conversations/${conversationId}`
          );

        if (!response.ok) {
          throw new Error(
            "Failed to refresh conversation"
          );
        }

        const data =
          await response.json();

        const formattedMessages =
          data.map(
            (message) => ({
              id: message.id,
              role: message.role,
              content: message.content,

              parentMessageId:
                message.parent_message_id ??
                message.parentMessageId ??
                null,

              version:
                message.version ?? 1,

              selectedText:
                message.selected_text ??
                message.selectedText ??
                null,

              selectedMessageId:
                message.selected_message_id ??
                message.selectedMessageId ??
                null,
            })
          );

        setMessages(
          formattedMessages
        );

        // Keep sidebar updated too
        await loadConversations();

      } catch (error) {

        console.error(
          "Failed to refresh conversation:",
          error
        );
      }
    };


  // =========================
  // SEND QUESTION
  // =========================

  const askQuestion = async () => {

    if (
      !question.trim() ||
      isGenerating ||
      !conversationId
    ) {
      return;
    }

    setIsGenerating(true);

    const userQuestion =
      question.trim();

    const attachedText =
      selectedText;

    const attachedMessageId =
      selectedMessageId;

    setQuestion("");

    setShowSelectionAction(false);

    const temporaryUserId =
      `temp-user-${Date.now()}`;

    const temporaryAssistantId =
      `temp-assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,

      {
        id: temporaryUserId,
        role: "user",
        content: userQuestion,

        selectedText:
          attachedText || null,

        selectedMessageId:
          attachedMessageId || null,
      },

      {
        id: temporaryAssistantId,
        role: "assistant",
        content: "",
        isGenerating: true,
      },
    ]);

    try {

      let endpoint;

      // =========================
      // NORMAL QUESTION
      // =========================

      if (!attachedText) {

        endpoint =
          "http://127.0.0.1:8000/ask" +
          `?question=${encodeURIComponent(
            userQuestion
          )}` +
          `&conversation_id=${conversationId}`;

      }

      // =========================
      // FOLLOW-UP QUESTION
      // =========================

      else {

        endpoint =
          "http://127.0.0.1:8000/ask-selection" +
          `?question=${encodeURIComponent(
            userQuestion
          )}` +
          `&selected_text=${encodeURIComponent(
            attachedText
          )}` +
          `&selected_message_id=${encodeURIComponent(
            attachedMessageId
          )}` +
          `&conversation_id=${conversationId}`;
      }

      const response =
        await fetch(endpoint);

      if (!response.ok) {
        throw new Error(
          "Request failed"
        );
      }

      if (!response.body) {
        throw new Error(
          "Streaming is not supported"
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let answer = "";

      while (true) {

        const {
          value,
          done,
        } = await reader.read();

        if (done) break;

        const chunk =
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        const lines =
          chunk.split("\n");

        for (
          const line of lines
        ) {

          if (!line.trim())
            continue;

          try {

            const data =
              JSON.parse(line);

            answer +=
              data.response || "";

            setMessages(
              (prev) => {

                const updated = [
                  ...prev,
                ];

                const assistantIndex =
                  updated.findIndex(
                    (message) =>
                      message.id ===
                      temporaryAssistantId
                  );

                if (
                  assistantIndex !==
                  -1
                ) {

                  updated[
                    assistantIndex
                  ] = {

                    ...updated[
                    assistantIndex
                    ],

                    content:
                      answer,
                  };
                }

                return updated;
              }
            );

          } catch (error) {

            console.error(
              "Failed to parse stream chunk:",
              error
            );
          }
        }
      }
      // Streaming finished
      setMessages((prev) =>
        prev.map((message) =>
          message.id === temporaryAssistantId
            ? {
              ...message,
              isGenerating: false,
            }
            : message
        )
      );
      // Clear active selection
      setSelectedText("");

      setSelectedMessageId(null);

      window
        .getSelection()
        ?.removeAllRanges();

      // Replace temporary IDs
      // with real database IDs.
      await refreshConversation();

    } catch (error) {

      console.error(error);

      setMessages(
        (prev) => {

          const updated = [
            ...prev,
          ];

          const assistantIndex =
            updated.findIndex(
              (message) =>
                message.id ===
                temporaryAssistantId
            );

          if (
            assistantIndex !==
            -1
          ) {

            updated[
              assistantIndex
            ] = {

              ...updated[
              assistantIndex
              ],

              content:
                "Sorry, I couldn't connect to the AI service.",
            };
          }

          return updated;
        }
      );

    } finally {

      setIsGenerating(false);
    }
  };

  // =========================
  // RESPONSE ACTIONS
  // =========================

  const [ratedMessages, setRatedMessages] = useState({});
  const [versionIndexes, setVersionIndexes] = useState({});
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  const copyResponse = async (messageId, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);

      setTimeout(() => {
        setCopiedMessageId((current) =>
          current === messageId ? null : current
        );
      }, 1500);
    } catch (error) {
      console.error("Failed to copy response:", error);
    }
  };

  const rateResponse = (messageId, rating) => {
    setRatedMessages((prev) => ({
      ...prev,
      [messageId]:
        prev[messageId] === rating
          ? null
          : rating,
    }));
  };

  const shareResponse = async (text) => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Enterprise AI Copilot",
          text: text,
        });
      } else {
        await navigator.clipboard.writeText(text);

        alert("Response copied to clipboard.");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Failed to share response:", error);
        alert("Unable to share response.");
      }
    }
  };

  const regenerateResponse = async (messageId) => {
    if (isGenerating || !conversationId) return;

    const assistantMessage =
      messages.find(
        (message) => message.id === messageId
      );

    if (
      !assistantMessage ||
      assistantMessage.role !== "assistant"
    ) {
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/regenerate" +
        `?message_id=${messageId}` +
        `&conversation_id=${conversationId}`
      );

      if (!response.ok) {
        throw new Error("Regeneration failed");
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const rootId =
        assistantMessage.parentMessageId ||
        assistantMessage.id;

      setMessages((prev) => [
        ...prev,
        {
          id: data.id,
          role: "assistant",
          content: data.content,
          parentMessageId: rootId,
          version: data.version,
          selectedText: null,
          selectedMessageId: null,
        },
      ]);

      // Show the newly generated version immediately
      setVersionIndexes((prev) => ({
        ...prev,
        [rootId]:
          getMessageVersions(assistantMessage).length,
      }));

    } catch (error) {
      console.error(
        "Failed to regenerate response:",
        error
      );
    } finally {
      setIsGenerating(false);
    }
  };
  const getMessageVersions = (message) => {
    if (!message) return [];

    const rootId =
      message.parentMessageId || message.id;

    return messages.filter((item) => {
      if (item.role !== "assistant") return false;

      return (
        item.id === rootId ||
        item.parentMessageId === rootId
      );
    });
  };
  //=========================
  // UI
  // =========================

  return (
    <div
      className="app"
      onMouseUp={
        handleTextSelection
      }
    >

      {/* =========================
          SIDEBAR
      ========================= */}

      <aside
        className={`sidebar ${sidebarOpen
          ? ""
          : "collapsed"
          }`}
      >

        <div className="sidebar-header">

          {sidebarOpen && (
            <div className="logo">
              <CopilotLogo size={48} />
            </div>
          )}

          <button
            className="collapse-btn"
            onClick={() =>
              setSidebarOpen(
                !sidebarOpen
              )
            }
            title={
              sidebarOpen
                ? "Collapse sidebar"
                : "Expand sidebar"
            }
          >
            ☰
          </button>

        </div>


        {/* =========================
            NEW CHAT
        ========================= */}

        <button
          className="new-chat"
          onClick={
            createConversation
          }
          disabled={
            isGenerating
          }
        >
          ＋ New chat
        </button>


        {/* =========================
            RECENT
        ========================= */}

        <div className="sidebar-title">
          Recent
        </div>


        <div className="conversation-list">

          {conversations.map(
            (conversation) => (

              <div
                key={
                  conversation.id
                }
                className={`history-item ${conversation.id ===
                  conversationId
                  ? "active"
                  : ""
                  }`}
              >

                <button
                  className="history-button"
                  onClick={() =>
                    loadConversation(conversation.id)
                  }
                  disabled={isGenerating}
                  title={conversation.title}
                >
                  <span className="history-title">
                    {conversation.title}
                  </span>
                </button>


                {/* =========================
                    THREE DOT MENU
                ========================= */}

                <button
                  className="history-menu-button"
                  onClick={(e) => {

                    e.stopPropagation();

                    setOpenMenuId(
                      openMenuId ===
                        conversation.id
                        ? null
                        : conversation.id
                    );

                  }}
                  disabled={
                    isGenerating
                  }
                  title="Conversation options"
                >
                  ⋯
                </button>


                {openMenuId ===
                  conversation.id && (

                    <div
                      className="history-menu"
                      onClick={(e) =>
                        e.stopPropagation()
                      }
                    >

                      <button
                        className="delete-chat"
                        onClick={() =>
                          deleteConversation(
                            conversation.id
                          )
                        }
                      >
                        Delete
                      </button>

                    </div>

                  )}

              </div>

            )
          )}

        </div>

      </aside>


      {/* =========================
          MAIN CHAT
      ========================= */}

      <main className="chat-area">

        <header className="topbar">

          <div className="brand-logo">
            <CopilotLogo size={42} />

            <span className="brand-name">
              Enterprise AI Copilot
            </span>
          </div>

          <div className="status">

            <span className="dot"></span>

            Local AI

          </div>

        </header>


        {/* =========================
            MESSAGES
        ========================= */}

        <div className="messages">

          {messages.length === 0 ? (

            <div className="welcome">



              <h1>
                How can I help you?
              </h1>

              <p>
                Ask questions, analyze
                information, or work
                with your enterprise data.
              </p>

            </div>

          ) : (

            messages
              .filter((message) => {
                if (message.role !== "assistant") {
                  return true;
                }

                const rootId =
                  message.parentMessageId || message.id;

                const versions =
                  getMessageVersions(message);

                if (versions.length <= 1) {
                  return true;
                }

                const currentIndex =
                  versionIndexes[rootId] ?? 0;

                return (
                  versions[currentIndex]?.id === message.id
                );
              })
              .map(
                (message) => (
                  <div
                    key={
                      message.id
                    }
                    data-message-id={
                      message.id
                    }
                    className={`message ${message.role ===
                      "user"
                      ? "user"
                      : "assistant"
                      }`}
                  >

                    <div className="avatar">
                      {message.role === "user" ? (
                        "V"
                      ) : (
                        <CopilotLogo size={36} />
                      )}
                    </div>


                    <div className="message-content">

                      {/* Reference */}

                      {message.role ===
                        "user" &&
                        message.selectedText && (

                          <button
                            className="message-context"
                            onClick={() =>
                              scrollToReference(
                                message.selectedMessageId,
                                message.selectedText
                              )
                            }
                            title="Go to referenced text"
                          >

                            <span className="message-context-icon">
                              ↳
                            </span>

                            <span className="message-context-text">
                              {
                                message.selectedText
                              }
                            </span>

                          </button>

                        )}


                      {/* Message */}

                      {message.role === "assistant" ? (

                        (() => {
                          const versions =
                            getMessageVersions(message);

                          const rootId =
                            message.parentMessageId || message.id;

                          const currentIndex =
                            versionIndexes[rootId] ?? 0;

                          const selectedVersion =
                            versions[currentIndex];

                          if (
                            !selectedVersion ||
                            selectedVersion.id !== message.id
                          ) {
                            return null;
                          }

                          return (

                            <>
                              <ReactMarkdown>
                                {message.content}
                              </ReactMarkdown>

                              {message.content && !message.isGenerating && (
                                <div className="response-actions">

                                  {/* COPY */}
                                  <button
                                    className="response-action"
                                    onClick={() =>
                                      copyResponse(
                                        message.id,
                                        message.content
                                      )
                                    }
                                    title="Copy response"
                                    aria-label="Copy response"
                                  >
                                    {copiedMessageId === message.id
                                      ? "✓"
                                      : "⧉"}
                                  </button>

                                  {/* THUMBS UP */}
                                  <button
                                    className={`response-action ${ratedMessages[message.id] === "up"
                                      ? "rated"
                                      : ""
                                      }`}
                                    onClick={() =>
                                      rateResponse(message.id, "up")
                                    }
                                    title="Good response"
                                    aria-label="Good response"
                                  >
                                    👍
                                  </button>

                                  {/* THUMBS DOWN */}
                                  <button
                                    className={`response-action ${ratedMessages[message.id] === "down"
                                      ? "rated"
                                      : ""
                                      }`}
                                    onClick={() =>
                                      rateResponse(message.id, "down")
                                    }
                                    title="Bad response"
                                    aria-label="Bad response"
                                  >
                                    👎
                                  </button>


                                  {/* REGENERATE */}
                                  <button
                                    className="response-action"
                                    onClick={() =>
                                      regenerateResponse(message.id)
                                    }
                                    disabled={isGenerating}
                                    title="Regenerate response"
                                    aria-label="Regenerate response"
                                  >
                                    <span className="regenerate-icon">↻</span>
                                  </button>

                                  {/* VERSION NAVIGATION */}
                                  {versions.length > 1 && (
                                    <div className="version-navigation">
                                      <button
                                        className="version-arrow"
                                        disabled={currentIndex === 0}
                                        onClick={() =>
                                          setVersionIndexes((prev) => ({
                                            ...prev,
                                            [rootId]: currentIndex - 1,
                                          }))
                                        }
                                        aria-label="Previous response"
                                      >
                                        ‹
                                      </button>

                                      <span className="version-count">
                                        {currentIndex + 1}/{versions.length}
                                      </span>

                                      <button
                                        className="version-arrow"
                                        disabled={
                                          currentIndex === versions.length - 1
                                        }
                                        onClick={() =>
                                          setVersionIndexes((prev) => ({
                                            ...prev,
                                            [rootId]: currentIndex + 1,
                                          }))
                                        }
                                        aria-label="Next response"
                                      >
                                        ›
                                      </button>
                                    </div>
                                  )}

                                </div >
                              )}
                            </>
                          );
                        })()

                      ) : (



                        <div className="user-message-content">

                          <div className="user-question">
                            {message.content}
                          </div>

                          <div className="user-message-actions">

                            {/* COPY */}
                            <button
                              className="response-action"
                              onClick={() =>
                                copyResponse(
                                  message.id,
                                  message.content
                                )
                              }
                              title="Copy question"
                              aria-label="Copy question"
                            >
                              {copiedMessageId === message.id
                                ? "✓"
                                : "⧉"}
                            </button>

                            {/* EDIT */}
                            <button
                              className="response-action"
                              onClick={() => {
                                setQuestion(message.content);

                                setTimeout(() => {
                                  document
                                    .querySelector(".chat-input")
                                    ?.focus();
                                }, 50);
                              }}
                              title="Edit question"
                              aria-label="Edit question"
                            >
                              <span className="edit-icon">✎</span>
                            </button>

                          </div>

                        </div>

                      )}

                    </div>

                  </div>

                )
              )

          )}

        </div>

        {/* =========================
            COMPOSER
        ========================= */}

        <div className="composer-area">
          {/* =========================
                  SELECTION CONTEXT
              ========================= */}

          {showSelectionAction &&
            !isGenerating && (
              <div className="selection-context">

                <span className="selection-context-icon">
                  ↪
                </span>

                <span className="selection-context-text">
                  "{selectedText}"
                </span>

                <button
                  type="button"
                  className="selection-context-cancel"
                  onClick={() => {
                    setSelectedText("");
                    setSelectedMessageId(null);
                    setShowSelectionAction(false);
                    window.getSelection()?.removeAllRanges();
                  }}
                  title="Cancel selection"
                >
                  ×
                </button>

              </div>
            )}
          {selectedFiles.length > 0 && (
            <div className="selected-files">
              <div className="selected-files-list">
                {selectedFiles.map((file, index) => (
                  <div
                    className="selected-file"
                    key={`${file.name}-${index}`}
                  >
                    <span>📄</span>

                    <span className="selected-file-name">
                      {file.name}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFiles((files) =>
                          files.filter((_, i) => i !== index)
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="upload-documents-button"
                onClick={uploadDocuments}
                disabled={uploadingFiles}
              >
                {uploadingFiles
                  ? "Uploading..."
                  : `Upload ${selectedFiles.length} document${selectedFiles.length > 1 ? "s" : ""
                  }`}
              </button>
            </div>
          )}

          <div className="input-wrapper">
            <div className="attachment-container">

              <button
                className="attachment-button"
                onClick={(e) => {
                  e.stopPropagation();

                  setShowAttachmentMenu((prev) => !prev);
                }}
                type="button"
                title="Attach"
                disabled={isGenerating}
              >
                +
              </button>

              {showAttachmentMenu && !isGenerating && (
                <div className="attachment-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="upload-option">
                    📄 Upload document

                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      multiple
                      hidden
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);

                        if (files.length) {
                          setSelectedFiles((previous) => [
                            ...previous,
                            ...files,
                          ]);
                        }

                        setShowAttachmentMenu(false);
                        e.target.value = "";
                      }}
                    />
                  </label>


                </div>
              )}

            </div>
            <textarea
              ref={textareaRef}
              rows={1}
              className="chat-input"
              value={question}
              rows={5}
              onChange={(e) => {
                setQuestion(e.target.value);

                e.target.style.height = "24px";

                e.target.style.height =
                  Math.min(e.target.scrollHeight, 192) + "px";
              }}

              onPaste={(e) => {
                e.preventDefault();

                const pastedText =
                  e.clipboardData.getData("text/plain");

                const cleanText =
                  pastedText.replace(
                    /[^\x09\x0A\x0D\x20-\x7E]/g,
                    ""
                  );

                setQuestion((prev) =>
                  prev + cleanText
                );
              }}

              onKeyDown={(e) => {

                if (
                  e.key === "Enter" &&
                  !e.shiftKey
                ) {

                  e.preventDefault();

                  if (!isGenerating) {
                    askQuestion();
                  }

                }

              }}

              placeholder={
                selectedText
                  ? "Ask a follow-up..."
                  : "Ask anything..."
              }

              disabled={!conversationId}
            />


            <button
              onClick={
                askQuestion
              }
              disabled={
                isGenerating ||
                !question.trim() ||
                !conversationId
              }
              title={
                isGenerating
                  ? "Wait for the response to finish"
                  : "Send message"
              }
            >
              ↑
            </button>

          </div>

        </div>


        <div className="footer">
          Enterprise AI Copilot • Powered by local Llama
        </div>

      </main >

    </div >
  );
}

export default App;