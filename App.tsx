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
  StatusBar,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCView,
  mediaDevices,
  RTCIceCandidate,
  RTCSessionDescription,
} from 'react-native-webrtc';

// Конфигурация STUN/TURN серверов для преодоления NAT
const configuration = {
  iceServers: [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun1.l.google.com:19302'},
    {urls: 'stun:stun2.l.google.com:19302'},
  ],
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

  const pc = useRef<RTCPeerConnection | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
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
          // Другой пользователь присоединился к комнате
          if (isCaller) {
            await createOffer();
          }
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
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
      if (pc.current) {
        pc.current.close();
      }
      if (localStream) {
        localStream.getTracks().forEach((track: any) => track.stop());
      }
    };
  }, []);

  const sendMessage = (message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  };

  const setupPeerConnection = async () => {
    // Создаем новое peer соединение
    pc.current = new RTCPeerConnection(configuration);

    // Добавляем локальный поток
    if (localStream) {
      localStream.getTracks().forEach((track: any) => {
        pc.current?.addTrack(track, localStream);
      });
    }

    // Обработка входящего потока
    pc.current.ontrack = (event: {streams: any[]}) => {
      console.log('Received remote track');
      setRemoteStream(event.streams[0]);
    };

    // Обработка ICE кандидатов
    pc.current.onicecandidate = (event: {candidate: any}) => {
      if (event.candidate) {
        sendMessage({
          type: 'ice-candidate',
          roomId: roomId,
          candidate: event.candidate,
        });
      }
    };

    // Мониторинг состояния соединения
    pc.current.onconnectionstatechange = () => {
      console.log('Connection state:', pc.current?.connectionState);
    };
  };

  const startLocalStream = async () => {
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: {ideal: 1280},
          height: {ideal: 720},
        },
      });
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      Alert.alert('Error', 'Failed to access camera/microphone');
      throw error;
    }
  };

  const createRoom = async () => {
    if (!roomId.trim()) {
      Alert.alert('Error', 'Please enter a room ID');
      return;
    }

    try {
      await startLocalStream();
      setIsCaller(true);
      setIsInCall(true);

      // Присоединяемся к комнате
      sendMessage({
        type: 'join-room',
        roomId: roomId,
      });

      await setupPeerConnection();
    } catch (error) {
      console.error('Error creating room:', error);
    }
  };

  const joinRoom = async () => {
    if (!roomId.trim()) {
      Alert.alert('Error', 'Please enter a room ID');
      return;
    }

    try {
      await startLocalStream();
      setIsCaller(false);
      setIsInCall(true);

      // Присоединяемся к комнате
      sendMessage({
        type: 'join-room',
        roomId: roomId,
      });

      await setupPeerConnection();
    } catch (error) {
      console.error('Error joining room:', error);
    }
  };

  const createOffer = async () => {
    try {
      const offer = await pc.current?.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await pc.current?.setLocalDescription(offer);

      sendMessage({
        type: 'offer',
        roomId: roomId,
        offer: offer,
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const handleOffer = async (offer: RTCSessionDescription) => {
    try {
      if (!pc.current) {
        await setupPeerConnection();
      }

      await pc.current?.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.current?.createAnswer();
      await pc.current?.setLocalDescription(answer);

      sendMessage({
        type: 'answer',
        roomId: roomId,
        answer: answer,
      });
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescription) => {
    try {
      await pc.current?.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidate) => {
    try {
      await pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  };

  const endCall = () => {
    // Закрываем соединение
    if (pc.current) {
      pc.current.close();
      pc.current = null;
    }

    // Останавливаем локальный поток
    if (localStream) {
      localStream.getTracks().forEach((track: any) => track.stop());
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
          />

          <TouchableOpacity style={styles.button} onPress={createRoom}>
            <Text style={styles.buttonText}>Create Room</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.joinButton]}
            onPress={joinRoom}>
            <Text style={styles.buttonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.callContainer}>
          <View style={styles.videoContainer}>
            {remoteStream && (
              <RTCView
                streamURL={remoteStream.toURL()}
                style={styles.remoteVideo}
                objectFit="cover"
              />
            )}

            {localStream && (
              <RTCView
                streamURL={localStream.toURL()}
                style={styles.localVideo}
                objectFit="cover"
              />
            )}
          </View>

          <View style={styles.callInfo}>
            <Text style={styles.roomIdText}>Room: {roomId}</Text>
            <Text style={styles.roleText}>
              Role: {isCaller ? 'Caller' : 'Receiver'}
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
  joinButton: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
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
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 10,
    borderRadius: 5,
  },
  roomIdText: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 5,
  },
  roleText: {
    color: '#fff',
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
