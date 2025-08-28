// App.tsx
import React, {useEffect, useState, useRef} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  StatusBar
} from 'react-native';
import {
  RTCPeerConnection,
  RTCView,
  mediaDevices,
  RTCIceCandidate,
  RTCSessionDescription,
} from 'react-native-webrtc';

// Улучшенная конфигурация STUN/TURN серверов
const configuration = {
  iceServers: [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun1.l.google.com:19302'},
    {urls: 'stun:stun2.l.google.com:19302'},
    // Добавляем публичные TURN серверы для случаев, когда STUN недостаточно
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};

// WebSocket URL вашего сигнального сервера
const SIGNALING_SERVER_URL = 'ws://47.254.176.143:8080';

function App(): JSX.Element {
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [roomId, setRoomId] = useState('');
  const [isInCall, setIsInCall] = useState(false);
  const [isCaller, setIsCaller] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState('disconnected');

  const pc = useRef<RTCPeerConnection | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<any>(null);

  // Инициализация WebSocket соединения
  useEffect(() => {
    initializeWebSocket();

    return () => {
      cleanup();
    };
  }, []);

  const initializeWebSocket = () => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      return; // Соединение уже установлено
    }

    ws.current = new WebSocket(SIGNALING_SERVER_URL);

    ws.current.onopen = () => {
      console.log('WebSocket Connected');
      setIsConnected(true);
    };

    ws.current.onmessage = async event => {
      const message = JSON.parse(event.data);
      console.log('Received message:', message.type);

      switch (message.type) {
        case 'offer':
          await handleOffer(message.offer);
          break;
        case 'answer':
          await handleAnswer(message.answer);
          break;
        case 'ice-candidate':
          await handleIceCandidate(message.candidate);
          break;
        case 'room-joined':
          console.log('Room joined successfully');
          break;
        case 'user-joined':
          console.log('User joined room');
          // Другой пользователь присоединился к комнате
          if (isCaller && pc.current) {
            await createOffer();
          }
          break;
        case 'user-left':
          console.log('User left room');
          handleUserLeft();
          break;
        case 'error':
          Alert.alert('Error', message.message);
          break;
      }
    };

    ws.current.onerror = error => {
      console.error('WebSocket error:', error);
      Alert.alert('Connection Error', 'Failed to connect to signaling server');
    };

    ws.current.onclose = () => {
      console.log('WebSocket Disconnected');
      setIsConnected(false);
      // Попытка переподключения через 3 секунды
      setTimeout(() => {
        if (!isConnected) {
          initializeWebSocket();
        }
      }, 3000);
    };
  };

  const cleanup = () => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    if (pc.current) {
      pc.current.close();
      pc.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => track.stop());
      localStreamRef.current = null;
    }
  };

  const sendMessage = (message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
      console.log('Sent message:', message.type);
    } else {
      console.error('WebSocket not connected');
    }
  };

  const setupPeerConnection = async () => {
    try {
      // Создаем новое peer соединение
      pc.current = new RTCPeerConnection(configuration);

      // Добавляем локальный поток, если он есть
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track: any) => {
          pc.current?.addTrack(track, localStreamRef.current);
        });
        console.log('Added local stream to peer connection');
      }

      // Обработка входящего потока
      pc.current.ontrack = (event: any) => {
        console.log('Received remote track', event.streams[0]);
        setRemoteStream(event.streams[0]);
      };

      // Обработка ICE кандидатов
      pc.current.onicecandidate = (event: any) => {
        if (event.candidate) {
          console.log('Sending ICE candidate');
          sendMessage({
            type: 'ice-candidate',
            roomId: roomId,
            candidate: event.candidate,
          });
        }
      };

      // Мониторинг состояния соединения
      pc.current.onconnectionstatechange = () => {
        const state = pc.current?.connectionState || 'disconnected';
        console.log('Connection state:', state);
        setConnectionState(state);

        if (state === 'failed') {
          // Попытка восстановить соединение
          Alert.alert('Connection Failed', 'Trying to reconnect...');
          setupPeerConnection();
        }
      };

      pc.current.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.current?.iceConnectionState);
      };

      console.log('Peer connection setup completed');
    } catch (error) {
      console.error('Error setting up peer connection:', error);
      Alert.alert('Error', 'Failed to setup peer connection');
    }
  };

  const startLocalStream = async () => {
    try {
      console.log('Starting local media stream...');

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          facingMode: 'user',
          width: {min: 640, ideal: 1280, max: 1920},
          height: {min: 480, ideal: 720, max: 1080},
          frameRate: {min: 15, ideal: 30},
        },
      };

      const stream = await mediaDevices.getUserMedia(constraints);
      console.log('Got local stream:', stream);

      setLocalStream(stream);
      localStreamRef.current = stream;

      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      Alert.alert(
        'Media Access Error',
        'Failed to access camera/microphone. Please check permissions.'
      );
      throw error;
    }
  };

  const createRoom = async () => {
    if (!roomId.trim()) {
      Alert.alert('Error', 'Please enter a room ID');
      return;
    }

    if (!isConnected) {
      Alert.alert('Error', 'Not connected to signaling server');
      return;
    }

    try {
      console.log('Creating room:', roomId);
      await startLocalStream();
      await setupPeerConnection();

      setIsCaller(true);
      setIsInCall(true);

      // Присоединяемся к комнате
      sendMessage({
        type: 'join-room',
        roomId: roomId,
      });

    } catch (error) {
      console.error('Error creating room:', error);
      setIsInCall(false);
      setIsCaller(false);
    }
  };

  const joinRoom = async () => {
    if (!roomId.trim()) {
      Alert.alert('Error', 'Please enter a room ID');
      return;
    }

    if (!isConnected) {
      Alert.alert('Error', 'Not connected to signaling server');
      return;
    }

    try {
      console.log('Joining room:', roomId);
      await startLocalStream();
      await setupPeerConnection();

      setIsCaller(false);
      setIsInCall(true);

      // Присоединяемся к комнате
      sendMessage({
        type: 'join-room',
        roomId: roomId,
      });

    } catch (error) {
      console.error('Error joining room:', error);
      setIsInCall(false);
      setIsCaller(false);
    }
  };

  const createOffer = async () => {
    try {
      console.log('Creating offer...');
      if (!pc.current) {
        console.error('No peer connection available');
        return;
      }

      const offer = await pc.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await pc.current.setLocalDescription(offer);
      console.log('Local description set, sending offer');

      sendMessage({
        type: 'offer',
        roomId: roomId,
        offer: offer,
      });
    } catch (error) {
      console.error('Error creating offer:', error);
      Alert.alert('Error', 'Failed to create offer');
    }
  };

  const handleOffer = async (offer: RTCSessionDescription) => {
    try {
      console.log('Handling offer...');
      if (!pc.current) {
        console.error('No peer connection available');
        return;
      }

      await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('Remote description set');

      const answer = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answer);
      console.log('Answer created and local description set');

      sendMessage({
        type: 'answer',
        roomId: roomId,
        answer: answer,
      });
    } catch (error) {
      console.error('Error handling offer:', error);
      Alert.alert('Error', 'Failed to handle incoming call');
    }
  };

  const handleAnswer = async (answer: RTCSessionDescription) => {
    try {
      console.log('Handling answer...');
      if (!pc.current) {
        console.error('No peer connection available');
        return;
      }

      await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Answer processed successfully');
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidate) => {
    try {
      console.log('Adding ICE candidate...');
      if (!pc.current) {
        console.error('No peer connection available');
        return;
      }

      await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('ICE candidate added successfully');
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  };

  const handleUserLeft = () => {
    console.log('Other user left the call');
    Alert.alert('Call Ended', 'Other user left the call');
    endCall();
  };

  const endCall = () => {
    console.log('Ending call...');

    // Закрываем соединение
    if (pc.current) {
      pc.current.close();
      pc.current = null;
    }

    // Останавливаем локальный поток
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => track.stop());
      localStreamRef.current = null;
    }

    // Отправляем сообщение о выходе
    sendMessage({
      type: 'leave-room',
      roomId: roomId,
    });

    // Сбрасываем состояние
    setLocalStream(null);
    setRemoteStream(null);
    setIsInCall(false);
    setIsCaller(false);
    setConnectionState('disconnected');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />

      <View style={styles.header}>
        <Text style={styles.title}>P2P Video Call</Text>
        <View style={styles.statusContainer}>
          <View
            style={[
              styles.statusDot,
              isConnected ? styles.connected : styles.disconnected,
            ]}
          />
          <Text style={styles.statusText}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Text>
          {isInCall && (
            <Text style={styles.connectionState}>
              {' • '}{connectionState}
            </Text>
          )}
        </View>
      </View>

      {!isInCall ? (
        <View style={styles.joinContainer}>
          <TextInput
            style={styles.input}
            placeholder="Enter Room ID"
            placeholderTextColor="#666"
            value={roomId}
            onChangeText={setRoomId}
            autoCorrect={false}
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.button, !isConnected && styles.buttonDisabled]}
            onPress={createRoom}
            disabled={!isConnected}
          >
            <Text style={styles.buttonText}>Create Room</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.joinButton, !isConnected && styles.buttonDisabled]}
            onPress={joinRoom}
            disabled={!isConnected}
          >
            <Text style={styles.buttonText}>Join Room</Text>
          </TouchableOpacity>

          <Text style={styles.instructions}>
            1. Enter a room ID{'\n'}
            2. Create room or join existing one{'\n'}
            3. Share room ID with someone to call
          </Text>
        </View>
      ) : (
        <View style={styles.callContainer}>
          <View style={styles.videoContainer}>
            {remoteStream ? (
              <RTCView
                streamURL={remoteStream.toURL()}
                style={styles.remoteVideo}
                objectFit="cover"
              />
            ) : (
              <View style={styles.waitingContainer}>
                <Text style={styles.waitingText}>
                  {isCaller ? 'Waiting for someone to join...' : 'Connecting...'}
                </Text>
              </View>
            )}

            {localStream && (
              <RTCView
                streamURL={localStream.toURL()}
                style={styles.localVideo}
                objectFit="cover"
                mirror={true}
              />
            )}
          </View>

          <View style={styles.callInfo}>
            <Text style={styles.roomIdText}>Room: {roomId}</Text>
            <Text style={styles.roleText}>
              Role: {isCaller ? 'Caller' : 'Receiver'}
            </Text>
            <Text style={styles.connectionText}>
              Status: {connectionState}
            </Text>
          </View>

          <TouchableOpacity style={styles.endButton} onPress={endCall}>
            <Text style={styles.buttonText}>End Call</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    flexWrap: 'wrap',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 5,
  },
  connected: {
    backgroundColor: '#4CAF50',
  },
  disconnected: {
    backgroundColor: '#f44336',
  },
  statusText: {
    color: '#fff',
    fontSize: 14,
  },
  connectionState: {
    color: '#4CAF50',
    fontSize: 12,
  },
  joinContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 15,
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#444',
  },
  button: {
    backgroundColor: '#2196F3',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: {
    backgroundColor: '#666',
  },
  joinButton: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  instructions: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
  callContainer: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  remoteVideo: {
    flex: 1,
  },
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  waitingText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
  },
  localVideo: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  callInfo: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 10,
    borderRadius: 5,
    minWidth: 150,
  },
  roomIdText: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 5,
  },
  roleText: {
    color: '#fff',
    fontSize: 12,
    marginBottom: 3,
  },
  connectionText: {
    color: '#4CAF50',
    fontSize: 12,
  },
  endButton: {
    backgroundColor: '#f44336',
    margin: 20,
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
  },
});

export default App;
