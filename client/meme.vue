<template>
  <k-card>
    <el-upload
      class="upload-meme"
      :action="`${route.path}/files`"
      :data="{
        user: JSON.stringify(store.user)
      }"
      :before-remove="(onRemove as any)"
      :before-upload="(beforeUpload as any)"
      :file-list="fileList"
      :on-error="onError"
      :on-success="onSuccess"
      @exceed="message.error($event)"
      list-type="picture"
      drag
      multiple
    >
      <template #default>
        <div>
          <k-icon name="arrow-up">
            <upload-filled />
          </k-icon>
          <div class="el-upload__text">
            将模板文件拖到此处或
            <em>点击上传</em>
          </div>
          <div class="el-upload__tip">svg/xcf 文件；最大 20mb</div>
        </div>
      </template>
      <template #file="{ file }">
        <a @click="onPreview(file)">
          <img
            class="el-upload-list__item-thumbnail"
            :src="
              store.memes?.allMemes?.includes(file.name)
                ? `${route.path}/files/${file.name}.png`
                : undefined
            "
          />
          <span class="el-upload-list__item-tags">
            <el-tag type="success" v-if="store.memes?.approvedMemes.includes(file.name)">已审核</el-tag>
            <el-tag v-else>待审核</el-tag>
          </span>

          <a class="el-upload-list__item-name">{{ file.name }}</a>
        </a>
        <i class="el-icon el-icon--close">
          <k-icon name="times-full" @click="onRemove(file, fileList)"></k-icon>
        </i>
      </template>
    </el-upload>
    <el-dialog v-model="dialogVisible">
      <template #title>
        <b style="margin-right: 1rem;">{{ dialogFile?.name }}</b>
        <span>
          <el-tag
            type="success"
            v-if="store.memes?.approvedMemes.includes(dialogFile?.name || '')"
          >已审核</el-tag>
          <el-tag v-else>待审核</el-tag>
        </span>
      </template>
      <template #default>
        <div class="meme-preview-wrapper">
          <div class="meme-preview-img">
            <img :src="dialogImageUrl" />
          </div>
          <div class="meme-preview-input">
            <k-schema
              class="meme-preview-schema"
              :schema="Schema.array(Schema.string())"
              v-model="testArgs"
            >梗图参数</k-schema>
            <k-button @click="generateMeme" class="meme-preview-btn-generate">生成</k-button>
          </div>
        </div>
      </template>
      <template #footer>
        <a :href="dialogTemplateUrl" target="_blank" style="margin-right: 1rem;">
          <button class="el-button">下载模板</button>
        </a>
        <el-button v-if="store.user" @click="onApprove" style="margin-right: 1rem;">审核模板</el-button>
      </template>
    </el-dialog>
  </k-card>
</template>

<script lang="ts" setup>
import { message, send, store, loading } from '@koishijs/client';
import { } from '@koishijs/plugin-auth';
import { ElDialog, ElTag, ElUpload, ElButton } from 'element-plus';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/icon/style/css';
import { UploadFile } from 'element-plus/es/components/upload/src/upload.type';
import 'element-plus/es/components/upload/style/css';
import { } from 'koishi-plugin-meme';
import Schema from 'schemastery';
import { computed, nextTick, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errMsg } from './utils';

const route = useRoute()

const fileList = computed(() => (store.memes?.allMemes || []).map<UploadFile>(name => ({
  name,
  status: 'ready',
  size: 0,
  uid: 0,
  raw: undefined as never
})))

const testArgs = ref([''])
const dialogImageUrl = ref('')
const dialogTemplateUrl = ref('')
const dialogVisible = ref(false)
const dialogFile = ref<UploadFile>()
function onPreview(file: UploadFile) {
  dialogVisible.value = true
  dialogImageUrl.value = `${route.path}/files/${file.name}.png`
  dialogTemplateUrl.value = `${route.path}/files/${file.name}`
  dialogFile.value = file
}

function refresh(): void {
  send('meme/refresh');
}

async function beforeUpload(file: UploadFile, _fileList: UploadFile[]): Promise<void> {
  try {
    if (!file.name.toLowerCase().endsWith('.xcf') && !file.name.toLowerCase().endsWith('.svg'))
      throw new Error('请上传 xcf 文件')
    if (file.size > 20 * 1024 * 1024)
      throw new Error('文件大于 20mb')

    // delete first if exist
    if (store.memes?.allMemes?.includes(file.name)) {
      await send('meme/delete', file.name, false)
      message.info(`已自动删除同名模板：${file.name}`)
    }
  } catch (e) {
    message.error(`上传失败：${errMsg(e)}`)
    throw e
  }
}

async function onError(error: unknown) {
  message.error(`文件上传失败：${errMsg(error)}`)
}

async function onSuccess(...args: any) {
  console.log(args)
  message.success(`文件上传成功`)
}

async function onRemove(file: UploadFile, _fileList: UploadFile[]): Promise<boolean> {
  if (!store.memes?.allMemes?.includes(file.name)) return true;
  try {
    await send('meme/delete', file.name)
    message.success(`成功删除模板 ${file.name}`)
  } catch (e) {
    message.error(`${file.name} 删除失败：${errMsg(e)}`)
    throw e
  }
  return true
}

async function onApprove() {
  const filename = dialogFile.value?.name
  if (!filename) return message.error('未知错误')
  const previouslyApproved = store.memes?.approvedMemes.includes(filename)
  await send('meme/approve', filename)
  message.success(`模板 ${filename} 已修改为 “${previouslyApproved ? '待审核' : '已审核'
    }”`)
}

async function generateMeme() {
  let loadingInstance;
  try {
    loadingInstance = loading({
      fullscreen: true
    })
    await nextTick()
    const template = dialogFile.value
    if (!template) throw new Error('generateMeme with undefined current file. Should never happen')
    const base64 = await send('meme/preview', template.name, testArgs.value)
    dialogImageUrl.value = 'data:image/png;base64,' + base64
  } catch (e) {
    message.warning(`预览失败：${errMsg(e)}`)
  }
  loadingInstance?.close()
}
</script>
<style lang="scss" scoped>
.meme-preview-wrapper {
  display: flex;
  gap: 2em;
  .meme-preview-img {
    img {
      max-width: 100%;
    }
  }
  .meme-preview-input {
    width: 20em;
    flex-shrink: 0;
  }
  .meme-preview-btn-generate {
    float: right;
    margin-right: 1rem;
  }
}
.el-upload-list__item-tags {
  float: right;
  margin-top: 20px;
}
</style>

<style lang="scss">
.upload-meme {
  .el-upload {
    width: 100%;
  }
  .el-upload-dragger {
    margin: 0 auto;

    display: flex;
    justify-content: center;
    flex-direction: column;
  }
}
</style>
