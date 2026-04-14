/** ElevenLabs Conversational AI API client */

const API_KEY = process.env.ELEVENLABS_API_KEY!
const BASE_URL = 'https://api.elevenlabs.io/v1'

interface AgentConfig {
  agent_id: string
  name?: string
  conversation_config?: {
    agent?: {
      prompt?: {
        prompt?: string
      }
      first_message?: string
      language?: string
    }
  }
}

interface AgentUpdatePayload {
  conversation_config?: {
    agent?: {
      prompt?: {
        prompt?: string
      }
      first_message?: string
    }
  }
}

export async function getAgent(agentId: string): Promise<AgentConfig | null> {
  try {
    const res = await fetch(`${BASE_URL}/convai/agents/${agentId}`, {
      headers: { 'xi-api-key': API_KEY },
    })
    if (!res.ok) {
      console.error(`ElevenLabs GET agent failed: ${res.status} ${res.statusText}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.error('ElevenLabs GET agent error:', e)
    return null
  }
}

export async function updateAgent(agentId: string, systemPrompt: string, firstMessage?: string): Promise<boolean> {
  try {
    const payload: AgentUpdatePayload = {
      conversation_config: {
        agent: {
          prompt: { prompt: systemPrompt },
          ...(firstMessage ? { first_message: firstMessage } : {}),
        },
      },
    }

    const res = await fetch(`${BASE_URL}/convai/agents/${agentId}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`ElevenLabs PATCH agent failed: ${res.status} ${text}`)
      return false
    }

    return true
  } catch (e) {
    console.error('ElevenLabs PATCH agent error:', e)
    return false
  }
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/convai/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': API_KEY },
    })
    return res.ok
  } catch (e) {
    console.error('ElevenLabs DELETE agent error:', e)
    return false
  }
}

export async function createAgent(templateAgentId: string, name: string): Promise<string | null> {
  try {
    // Get the template agent config to clone its settings
    const template = await getAgent(templateAgentId)
    if (!template) return null

    // Strip fields that shouldn't be copied to the new agent
    const { agent_id: _id, ...templateConfig } = template as unknown as Record<string, unknown>

    // Create a new agent (POST /v1/convai/agents — no /create suffix)
    const res = await fetch(`${BASE_URL}/convai/agents`, {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...templateConfig,
        name,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`ElevenLabs create agent failed: ${res.status} ${text}`)
      return null
    }

    const data = await res.json()
    return data.agent_id ?? null
  } catch (e) {
    console.error('ElevenLabs create agent error:', e)
    return null
  }
}
