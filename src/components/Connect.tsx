'use client'
import { connectAndClaimKey, getSessionSigsPKP } from '@/utils/connect'

function Connect() {

  return (
    <button onClick={connectAndClaimKey}>
        Connect
    </button>
  )
}

export default Connect