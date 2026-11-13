<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

// Redirect home to dashboard
router.push('/dashboard')
</script>

<template>
  <div class="home-redirect">
    <p>Redirecting to dashboard...</p>
  </div>
</template>

<style scoped>
.home-redirect {
  text-align: center;
  padding: 3rem;
  color: #666;
}
</style>