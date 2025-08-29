import React, { Component } from 'react';
import '../chat.css';
import minus_icon from '../components/img/minus.png';
import Pusher from 'pusher-js'; // ✅ IMPORT Pusher
import { connect } from 'react-redux';
import { getAuthTokenFromLocalStorage } from '../helpers/utils';

class Chat extends Component {
  state = {
    messages: [], // {content: 'some message', self: true, name: 'Vikas'}
    typedMessage: '',
    isChatOpen: true,
  };

  componentDidMount() {
    // This part remains the same
    const storedChatState = sessionStorage.getItem(`chatState_${this.props.user?.email}`);
    const initialChatState = storedChatState ? JSON.parse(storedChatState) : true;
    this.setState({ isChatOpen: initialChatState });

    // ✅ Setup Pusher connection if the user is logged in
    if (this.props.user?.email) {
      this.setupPusher();
    }
  }

  componentWillUnmount() {
    // ✅ Clean up Pusher connection
    if (this.pusher) {
      this.pusher.disconnect();
    }
  }
  
  // ✅ NEW: Setup Pusher logic
  setupPusher = () => {
    // Initialize Pusher with your public key and cluster
    this.pusher = new Pusher(process.env.REACT_APP_PUSHER_KEY, {
      cluster: process.env.REACT_APP_PUSHER_CLUSTER,
    });

    // Subscribe to the channel
    this.channel = this.pusher.subscribe('codeial'); // 'codeial' is our chatroom name

    // Bind to the 'new-message' event
    this.channel.bind('new-message', (data) => {
      const newMessage = {
        content: data.message,
        self: data.user_email === this.props.user.email,
        name: data.name, // We get the name from the backend now
        id: Date.now(),
      };

      this.setState((prevState) => ({
        messages: [...prevState.messages, newMessage],
      }));
    });
  };

  // ✅ UPDATED: Send messages using fetch
  handleSubmit = async () => {
    const { typedMessage } = this.state;
    const token = getAuthTokenFromLocalStorage();

    if (typedMessage && this.props.user?.email && token) {
      // Send message to your new backend endpoint
      await fetch('/api/v2/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: typedMessage,
          chatroom: 'codeial' // The channel name
        })
      });
      this.setState({ typedMessage: '' });
    }
  };

  toggleChat = () => {
    this.setState((prevState) => {
      const newState = !prevState.isChatOpen;
      sessionStorage.setItem(`chatState_${this.props.user.email}`, JSON.stringify(newState));
      return { isChatOpen: newState };
    });
  };

  render() {
    const { typedMessage, messages, isChatOpen } = this.state;

    return (
      <div
        className="chat-container"
        style={{ height: isChatOpen ? '400px' : '43px', transition: 'all 0.3s ease' }}
      >
        <div className="chat-header">
          Chat
          <img
            src={minus_icon}
            alt="Toggle chat"
            height={17}
            onClick={this.toggleChat}
            style={{ transform: isChatOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
          />
        </div>
        {isChatOpen && (
          <>
            <div className="chat-messages">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={message.self ? 'chat-bubble self-chat' : 'chat-bubble other-chat'}
                >
                  {!message.self && <div className="message-author">{message.name}</div>}
                  {message.content}
                </div>
              ))}
            </div>
            <div className="chat-footer">
              <input
                type="text"
                value={typedMessage}
                onChange={(e) => this.setState({ typedMessage: e.target.value })}
                onKeyPress={(e) => e.key === 'Enter' && this.handleSubmit()}
              />
              <button onClick={this.handleSubmit}>Send</button>
            </div>
          </>
        )}
      </div>
    );
  }
}

function mapStateToProps({ auth }) {
  return {
    user: auth.user,
  };
}

export default connect(mapStateToProps)(Chat);